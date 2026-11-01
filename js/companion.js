/*
 * 看板娘点击聊天（情感陪伴向）
 *
 * 设计约束：
 *   1. 站点是 GitHub Pages 纯静态，没有任何后端。所以默认走本地语料引擎，
 *      不联网也能用，不埋任何第三方请求。
 *   2. 想接大模型时，只在 _config.yml 填 companion.api = 自己的中转地址。
 *      密钥必须留在那个中转服务里；这里如果检测到 api_key 一类的字段会直接忽略并警告，
 *      静态站前端里的任何密钥都等于公开。
 *   3. 不改动 live2d 本体：hexo-helper-live2d 渲染出的 canvas 只在事件捕获层被观察，
 *      面板是另一层 DOM，卸载干净就行。
 *   4. 聊天记录不落地。localStorage 里只存称呼、心情标签计数、来访次数——
 *      别人的心事不该被写进任何人的浏览器缓存。
 */
(function () {
  'use strict';

  var CFG = {
    enable: true,
    name: '小满',
    tone: 'warm',
    api: '',
    timeout: 9000,
    hint: '点我和我说说话',
    chips: ['今天很累', '有点焦虑', '被打击了', '夸夸我', '睡不着', '就想静静'],
  };
  var k, provided = window.COMPANION || {};
  for (k in provided) if (Object.prototype.hasOwnProperty.call(provided, k)) CFG[k] = provided[k];
  if (!CFG.enable) return;

  // 前端不该出现密钥。看见了就当没看见，并且说清楚原因。
  if (provided.api_key || provided.apiKey || provided.token || provided.secret) {
    console.warn('[companion] 配置里的密钥字段已被忽略：静态站前端藏的密钥等于公开。请把密钥放在 companion.api 指向的中转服务里。');
  }

  var STORE = 'companion.v1';
  var st = load();

  function load() {
    var base = { name: '', visits: 0, lastDay: '', streak: 0, talks: 0, moods: {}, lastGreetDay: '' };
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return base;
      var o = JSON.parse(raw);
      for (var p in base) if (Object.prototype.hasOwnProperty.call(base, p) && o[p] !== undefined) base[p] = o[p];
      return base;
    } catch (e) {
      return base;
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(st));
    } catch (e) {
      /* 隐私模式或禁用存储时用内存态，不影响聊天 */
    }
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function touchVisit() {
    var t = today();
    if (st.lastGreetDay === t) return;
    st.lastGreetDay = t;
    var y = new Date(Date.now() - 86400000);
    var ys = y.getFullYear() + '-' + (y.getMonth() + 1) + '-' + y.getDate();
    st.streak = st.lastDay === ys ? st.streak + 1 : 1;
    st.lastDay = t;
    st.visits++;
    save();
  }

  /* ---------------- 语料 ----------------
   * 每个情绪四件东西：reflect 我先听到什么、accept 这句感受很正常、step 一个很小可执行的一步、
   * ask 把话递回去。发的时候按 reflect + accept (+ step) + ask 组合，
   * 用游标避免同一句连着两次说。
   */
  var MOODS = {
    anxious: {
      label: '焦虑',
      re: /(焦虑|紧张|慌|心跳|压力|deadline|截稿|答辩|面试|考试|汇报|评审|担心|怕搞砸|睡不着.*想)/i,
      reflect: ['听起来你正被一件事追着跑。', '那种"还没发生就已经累"的感觉，我认得。', '你在替还没到来的事情耗神，对吧？'],
      accept: ['会紧张说明你当真了，这不是缺点。', '焦虑不是脆弱，是身体在帮你抢跑，只是它抢得太早。', '这种时候还能坐在这里读技术文章，你已经挺稳了。'],
      step: ['我们把视线收回到"接下来 20 分钟能做的最小一步"，只那一步。', '先写三行：我怕的是什么 / 最坏会怎样 / 我现在能碰哪一块。写完焦虑就变小了一点。', '试试吸气 4 秒、屏 2 秒、呼气 6 秒，做三轮，心跳会先稳住。'],
      ask: ['最让你悬着的是哪一件事？', '如果只能先放下一件，你想放哪件？'],
    },
    low: {
      label: '低落',
      re: /(难过|难受|想哭|哭|丧|emo|低落|不开心|开心不起来|没意思|空虚|提不起劲|没劲|失望|心累)/i,
      reflect: ['你好像不太高兴，我在。', '这种闷闷的感觉不用急着解释。', '听起来今天对你不算温柔。'],
      accept: ['不必马上好起来，低落也是有位置的。', '什么都不想做的那会儿，其实是最需要被允许的一段。', '你不用为了让我放心而说"没事"。'],
      step: ['先喝一口水，或者站起来走到窗边 90 秒，只做这一件。', '把今天缩成一件小事就好，其余都算超额完成。', '要不要把此刻的心情写成一个词给我？'],
      ask: ['想说说是谁或什么事吗？不想说我们就安静待一会儿。', '这会儿你需要我陪着你，还是帮你想想下一步？'],
    },
    tired: {
      label: '透支',
      re: /(累|疲惫|肝|加班|熬夜|睡眠不足|困|没睡好|睡不够|透支|倦|睡不着|睡不好|入睡)/i,
      reflect: ['你是真的累了，不是矫情。', '这个"累"字说出来，就已经是照顾自己了。', '听上去你把自己用得太狠了。'],
      accept: ['长期加班的人不是抗压强，是欠觉多。'],
      step: ['今天给自己一个明确的收工时间，剩下的活儿明天不会消失。', '先躺平两分钟，手机扣过来，不睡也没关系，就是别再用眼睛了。', '今晚把闹钟往前拨 30 分钟，给入睡留点余地。'],
      ask: ['今天还能收得掉吗？', '是身体累，还是心更累一点？'],
    },
    selfdoubt: {
      label: '自我否定',
      re: /(我是不是太差|我好差|我不行|没救|废物|一事无成|比不上|不如别人|觉得自己.*糟|我很笨|拖累|讨厌自己|否定|打击|受挫|挫败|批评|被说|被怼|被嘲|被退|被刷|觉得自己)/i,
      reflect: ['先停一下——你刚才那句对你自己的评价，太狠了。', '我听到你在把自己往下踩。', '被当面否定一次，能在脑子里回旋好几天，这很正常。'],
      accept: ['人和人不同起跑，这不是你不够好的证据。', '你会拿别人的高光来比自己幕后，谁这么比都会输。', '对方那句是评价这件事，不是给你这个人下定论。'],
      step: ['把"我不行"改成"这件事我还没会"，只改这一句，感觉会不一样。', '翻一件你三个月前不会、现在会了的事，那就是你的证据。', '把那句话说得再具体一点：他否掉的到底是哪个部分？剩下的部分还在你手里。'],
      ask: ['如果有朋友说出你刚才那句话，你会怎么回他？'],
      late: ['深夜最容易自我攻击，那时候的判断力最差，先睡一觉再说。'],
    },
    lonely: {
      label: '孤独',
      re: /(孤独|一个人|没人|没人懂|没人理解|失恋|分手|喜欢.*不|朋友|吵架|被冷落|委屈|想念)/,
      reflect: ['一个人扛着的感觉，很空。', '你想被人懂，这个愿望一点都不过分。'],
      accept: ['孤独不是没人陪，是没人接住你说的话——这两件事能分开解决。'],
      step: ['今天找一个"能接一句"的人，只发一句"在忙吗"，剩下的看对方。'],
      ask: ['是身边没人，还是有人在却说不出口？'],
    },
    angry: {
      label: '烦躁',
      re: /(气死|生气|火大|烦死|烦躁|被骂|挨批|不公平|领导|同事|客户|杠精|恶心|讨厌死了)/,
      reflect: ['这事换谁都会上火。', '先允许自己气一会儿，气是有理由的。'],
      accept: ['愤怒通常站在"边界被踩了"那一侧，它在替你说话。'],
      step: ['先别回复那句话，写下来但发不出去，明早再看一次。', '把气的那件事写成一句"我不能接受的是……"，你会发现它变清楚了。'],
      ask: ['是谁、还是哪句话最刺你？'],
    },
    stuck: {
      label: '卡住',
      re: /(卡住|bug|报错|编译|调不通|写不出|拖延|不想动|起个头|没思路|论文|学不进|看不懂|没进度|摸鱼)/,
      reflect: ['卡住的时候最难的不是问题，是启动。', '你不是懒，是这一步太大了。'],
      accept: ['每个坑过的人都是从"对着屏幕不动"那段熬过来的。'],
      step: ['只做 5 分钟：把报错原文贴出来，或者写一行最蠢的开头。5 分钟后允许自己停。', '把任务拆到能在 10 分钟内打勾的粒度，先只拆，不做。'],
      ask: ['现在卡在哪一小步？说具体点，我陪你拆。'],
    },
    body: {
      label: '身体不适',
      re: /(生病|发烧|头疼|头痛|胃|肚子|疼|咳嗽|感冒|不舒服|医院|体检|失眠)/,
      reflect: ['身体不舒服的时候，别的都不用讲道理。'],
      accept: ['生病不是拖延的理由，是你本来就该休息。'],
      step: ['今天多喝水、早点躺，工作能推就推到明天。'],
      ask: ['疼了多久了？有在吃药吗？'],
    },
    happy: {
      label: '好消息',
      re: /(通过了|上岸|录用|拿到offer|升职|涨了|成功|太好了|开心|爽|终于.*了|搞定|过了|中奖|被夸)/,
      reflect: ['哇，这个值得停下手里的事高兴一下。', '听到了！恭喜。'],
      accept: ['别急着谦虚，你挣来的。'],
      step: ['做一件给它盖章的小事：记进今天的日志、买杯喝的、或者告诉一个会替你开心的人。'],
      ask: ['最想先跟谁说这个好消息？'],
    },
    praise: {
      label: '求肯定',
      re: /(夸我|鼓励|夸夸|骂醒|推我一把|给我打气|认可|夸一夸)/,
      reflect: ['来，正经理由地夸你。'],
      accept: ['你把一件别人看不见的坚持做到了今天，这本身就值得说。'],
      step: ['你今天来找人说话、还在读这篇技术文章，这两件都是"没放弃"的证据。'],
      ask: ['还想再听一句还是去干活？两句我都能给。'],
    },
    greeting: {
      label: '打招呼',
      re: /^(在吗|你好|您好|hi|hello|嗨|哈喽|早上|晚上|睡了没|你是谁|你叫什么)/i,
      reflect: ['在的，我一直守着这个角落。', '嗨，你来啦。'],
      accept: [],
      step: [],
      ask: ['今天想聊哪一件？或者只是想有个东西在旁边待着也行。'],
    },
    quiet: {
      label: '安静',
      re: /(不想说话|别吵|静静|陪着我|闭嘴|不用回|听着就好)/,
      reflect: ['好，我不追着问了。'],
      accept: [],
      step: ['我就在这儿，你想说的时候我随时接。'],
      ask: [],
    },
    idle: {
      label: '兜底',
      re: /.*/,
      reflect: ['我接不太住这句，但我在听。', '嗯，你继续说？'],
      accept: [],
      step: [],
      ask: ['这让你想到什么？'],
    },
  };

  var ORDER = ['anxious', 'low', 'tired', 'selfdoubt', 'lonely', 'angry', 'stuck', 'body', 'happy', 'praise', 'greeting', 'quiet'];

  // 危机语永远优先，且不走常规模板。
  var CRISIS = /(想死|不想活|自杀|活不下去|撑不下去|一了百了|伤害自己|割腕|结束这一切|没意义.*算了)/;

  var cursor = {};
  function pick(arr, key) {
    if (!arr || !arr.length) return '';
    var i = cursor[key] || 0;
    cursor[key] = (i + 1) % arr.length;
    return arr[i];
  }

  function detect(text) {
    var t = text.toLowerCase();
    for (var i = 0; i < ORDER.length; i++) {
      var key = ORDER[i];
      if (MOODS[key].re.test(t)) return key;
    }
    return 'idle';
  }

  function hour() {
    return new Date().getHours();
  }
  function isNight() {
    var h = hour();
    return h >= 23 || h < 5;
  }

  function nameOf() {
    return st.name ? st.name + '，' : '';
  }

  function localReply(text) {
    var out = [];
    if (CRISIS.test(text)) {
      out.push('这句话我认真接住，不打岔也不讲道理。');
      out.push('能说出"撑不下去"，通常是一个人扛了很久很久了。你不需要现在就好起来。');
      out.push('如果此刻已经很难保证自己的安全，请打 12356（全国心理援助热线，24 小时、免费），或者直接联系身边一个能马上到场的人。我在这儿，你说，我听。');
      return out;
    }
    var key = detect(text);
    var m = MOODS[key];
    var line;
    line = pick(m.reflect, key + '.r');
    if (line) out.push(line);
    line = pick(m.accept, key + '.a');
    if (line) out.push(line);
    if (m.step && Math.random() < 0.72) {
      line = pick(m.step, key + '.s');
      if (line) out.push(line);
    }
    if (key === 'selfdoubt' && isNight()) out.push(m.late[0]);
    if (isNight() && key !== 'quiet' && key !== 'happy' && Math.random() < 0.5) {
      out.push('已经这么晚了，这些话明天看可能轻一点——先睡，我明天还在这儿。');
    }
    line = pick(m.ask, key + '.q');
    if (line && out.length < 3) out.push(line);
    if (!out.length) out.push('嗯，我在听。');
    return out.slice(0, 3);
  }

  /* ---------------- 可选后端 ---------------- */
  function endpointOk(u) {
    if (!u) return false;
    if (!/^https:\/\//i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u)) return false;
    return true;
  }

  function askBackend(text, history) {
    if (!endpointOk(CFG.api)) return Promise.resolve(null);
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, CFG.timeout) : null;
    var body = {
      character: CFG.name,
      tone: CFG.tone,
      visitor_name: st.name || '',
      hour: hour(),
      streak: st.streak,
      history: history.slice(-10),
      message: text,
    };
    return fetch(CFG.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined,
    })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (timer) clearTimeout(timer);
        var lines = j && (Array.isArray(j.reply) ? j.reply : [j && (j.reply || j.text || j.message)]);
        lines = (lines || []).filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, 3);
        return lines.length ? lines : null;
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        return null; // 失败就退回本地语料，不给读者看错误
      });
  }

  /* ---------------- 界面 ---------------- */
  var root, panel, list, input, sendBtn, hint, open = false, history = [];

  function cssEsc(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function build() {
    root = document.createElement('div');
    root.className = 'cp-root';
    root.innerHTML =
      '<div class="cp-hint" role="status"></div>' +
      '<button class="cp-fab" type="button" aria-label="和' + CFG.name + '聊天"><span class="cp-fab-dot"></span><span class="cp-fab-txt">聊</span></button>' +
      '<section class="cp-panel" role="dialog" aria-label="和' + CFG.name + '聊天" aria-hidden="true">' +
      '<header class="cp-head"><span class="cp-avatar">' + CFG.name.slice(0, 1) + '</span>' +
      '<span class="cp-title">' + CFG.name + '<em>陪聊不评判</em></span>' +
      '<button class="cp-close" type="button" aria-label="收起">×</button></header>' +
      '<div class="cp-list" role="log" aria-live="polite"></div>' +
      '<div class="cp-chips"></div>' +
      '<form class="cp-form"><textarea rows="1" placeholder="想说什么都可以，不用组织好语言"></textarea>' +
      '<button class="cp-send" type="submit">发送</button></form>' +
      '</section>';
    document.body.appendChild(root);
    panel = root.querySelector('.cp-panel');
    list = root.querySelector('.cp-list');
    input = root.querySelector('.cp-form textarea');
    sendBtn = root.querySelector('.cp-send');
    hint = root.querySelector('.cp-hint');
    var chips = root.querySelector('.cp-chips');
    (CFG.chips || []).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cp-chip';
      b.textContent = c;
      chips.appendChild(b);
    });
  }

  function bubble(text, who) {
    var d = document.createElement('div');
    d.className = 'cp-msg cp-msg-' + (who || 'bot');
    d.textContent = text;
    list.appendChild(d);
    list.scrollTop = list.scrollHeight;
    return d;
  }
  function typing() {
    var d = bubble('…', 'bot');
    d.classList.add('cp-typing');
    return d;
  }

  function respond(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed) return;
    bubble(trimmed, 'me');
    history.push({ role: 'user', content: trimmed });
    var t = typing();
    askBackend(trimmed, history).then(function (lines) {
      var use = lines || localReply(trimmed);
      setTimeout(function () {
        t.remove();
        use.forEach(function (line, i) {
          setTimeout(function () {
            bubble(line, 'bot');
            history.push({ role: 'assistant', content: line });
          }, i * 340);
        });
        st.talks++;
        var mood = detect(trimmed);
        st.moods[mood] = (st.moods[mood] || 0) + 1;
        save();
        // 危机话术之后不接着问名字——那会儿该留在他的情绪里，不要转到闲聊。
        if (!st.name && history.length > 6 && !CRISIS.test(trimmed)) setTimeout(askName, 900);
      }, 420 + Math.random() * 420);
    });
  }

  function askName() {
    if (st.name || nameAsked) return;
    nameAsked = true;
    bubble('对了，怎么称呼你？不想说也完全没关系。', 'bot');
    history.push({ role: 'assistant', content: '(asking name)' });
    pendingName = true;
  }
  var pendingName = false;
  var nameAsked = false;

  function greeting() {
    if (st.lastGreetDay !== today()) touchVisit();
    var bits = [];
    if (st.streak >= 3) bits.push('第 ' + st.streak + ' 天见到你，' + nameOf() + '我把这件事记住了。');
    else if (st.visits > 1) bits.push('又见面了。' + (st.talks > 8 ? '你话比上次多了点，挺好。' : '今天也在这儿。'));
    else bits.push('第一次遇见你。' + '我是' + CFG.name + '，住在这个角落，主要负责不催你。');
    if (isNight()) bits.push('这个点还醒着，是睡不着，还是在赶工？');
    else if (hour() < 9) bits.push('早上第一件事不是干活也没关系。');
    var title = pageTitle();
    if (title && bits.length < 2) bits.push('你在看《' + title + '》？看完想聊两句随时点我。');
    return bits.slice(0, 2);
  }

  function pageTitle() {
    var h = document.querySelector('.article-title, .post-title, h1');
    var t = h ? String(h.textContent || '').trim() : '';
    return t.length > 2 && t.length < 40 ? t : '';
  }

  function setOpen(v) {
    open = v;
    panel.classList.toggle('cp-on', v);
    panel.setAttribute('aria-hidden', v ? 'false' : 'true');
    root.classList.toggle('cp-open', v);
    if (v) {
      hideHint();
      // 问候是 setTimeout 追加的，只用「列表空不空」当判据会在同一轮里重复触发，
      // 所以额外用 greeted 标志位兜住（setOpen(true) 可能被连点或被 chip 处理器再调一次）。
      if (!greeted) {
        greeted = true;
        greeting().forEach(function (g, i) {
          var put = function () { bubble(g, 'bot'); history.push({ role: 'assistant', content: g }); };
          // 第一句同步落屏：否则点快捷语时，自己的话会排到问候前面。
          if (i === 0) put(); else setTimeout(put, i * 260);
        });
      }
      setTimeout(function () { input.focus(); }, 260);
    }
  }
  var greeted = false;

  function showHint() {
    if (!hint || open) return;
    hint.textContent = CFG.hint;
    hint.classList.add('cp-show');
    setTimeout(hideHint, 6000);
  }
  function hideHint() {
    if (hint) hint.classList.remove('cp-show');
  }

  function bind() {
    root.querySelector('.cp-fab').addEventListener('click', function () { setOpen(!open); });
    root.querySelector('.cp-close').addEventListener('click', function () { setOpen(false); });
    root.querySelector('.cp-chips').addEventListener('click', function (e) {
      var b = e.target.closest('.cp-chip');
      if (b) { setOpen(true); respond(b.textContent); }
    });
    root.querySelector('.cp-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value;
      if (!v.trim()) return;
      input.value = '';
      if (pendingName) {
        pendingName = false;
        st.name = v.trim().slice(0, 12);
        save();
        bubble('好，' + st.name + '。我记住了。', 'bot');
        return;
      }
      respond(v);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        root.querySelector('.cp-form').dispatchEvent(new Event('submit', { cancelable: true }));
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    // 点看板娘本体也算开合；用捕获层，不拦 live2d 自己的拖拽和动作
    document.addEventListener(
      'click',
      function (e) {
        var w = e.target.closest('#live2dcanvas, .live2d-widget, #live2d, .live2d');
        if (!w) return;
        setOpen(!open);
      },
      true
    );
  }

  function dockFromModel() {
    // live2d 的 canvas 也是异步插进来的：模型在场就把「聊」按钮挪到它左边，
    // 不然按钮压在人物身上，点谁都是开合，看不出有个可点的入口。
    var m = document.querySelector('#live2dcanvas, .live2d-widget, #live2d, .live2d');
    if (!m || !root) return;
    var r = m.getBoundingClientRect();
    // 手机端 live2d 常被配置成隐藏，占位为 0 就别把按钮挪走。
    if (r.width < 60 || r.height < 60) return;
    root.classList.add('cp-dock-live2d');
  }

  function boot() {
    build();
    bind();
    touchVisit();
    dockFromModel();
    setTimeout(dockFromModel, 1500);
    setTimeout(dockFromModel, 4000);
    setTimeout(showHint, 2600);
  }

  function start() {
    // live2d 的 canvas 是异步插进来的；找不到也只挂按钮，不做无谓等待
    if (root) return;
    boot();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.__companion = { cfg: CFG, state: st, reply: localReply, respond: respond, open: function () { setOpen(true); } };
})();
