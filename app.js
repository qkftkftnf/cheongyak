/* 청약수첩 — 화면 */
(function () {
  'use strict';
  const R = window.RULES, L = window.Logic;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 저장소 (이 폰 브라우저에만) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('cy.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('cy.' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
    clearAll() { try { Object.keys(localStorage).filter(k => k.startsWith('cy.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* noop */ } },
  };

  // ---------- 상태 ----------
  const savedProfile = store.get('profile', null);
  let isExample = !savedProfile;
  let profile = Object.assign({}, L.EMPTY_PROFILE, savedProfile || L.EXAMPLE_PROFILE);
  const prefs = Object.assign(
    { tab: 'notice', mode: 'private', regions: [], kinds: ['apt', 'remndr'], days: 60, filter: 'active', region: '' },
    store.get('prefs', {})
  );
  let apiKey = store.get('apiKey', '');
  const stars = new Set(store.get('stars', []));
  let cache = store.get('notices', null);
  let notices = cache ? L.normalizeAll(cache.raw) : [];
  let loading = false, lastError = null;
  const modelCache = new Map();

  const savePrefs = () => store.set('prefs', prefs);
  const refDate = () => L.parseD(profile.refDate) || L.today();

  // ---------- 탭 ----------
  function showTab(name) {
    if (!$('#tab-' + name)) name = 'notice';
    prefs.tab = name; savePrefs();
    $$('.tab').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
    $$('.tabbar button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false'));
    window.scrollTo(0, 0);
  }
  $$('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) showTab(g.dataset.goto);
  });

  // ---------- 내 정보 입력 ----------
  function readControl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.type === 'bool') return el.value === '1';
    if (el.dataset.type === 'num') return el.value === '' ? '' : Number(el.value);
    return el.value;
  }
  function writeControl(el, v) {
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = (el.dataset.type === 'bool' ? (v ? '1' : '0') : String(v)) === el.value;
    else el.value = v == null ? '' : v;
  }
  function fillForms() {
    $$('[data-key]').forEach(el => {
      if (el.classList.contains('stepper')) el.querySelector('output').textContent = L.num(profile[el.dataset.key]);
      else writeControl(el, profile[el.dataset.key]);
    });
    syncConditional();
  }
  function syncConditional() {
    $$('[data-show-if]').forEach(el => {
      const [k, v] = el.dataset.showIf.split('=');
      const cur = profile[k] === true ? '1' : profile[k] === false ? '0' : String(profile[k]);
      el.hidden = cur !== v;
    });
  }
  function setField(key, value) {
    if (isExample) {
      // 예시 상태에서 처음 고치면 예시를 비우고 내 정보로 시작
      isExample = false;
      profile = Object.assign({}, L.EMPTY_PROFILE);
      profile[key] = value;
      fillForms();
    } else {
      profile[key] = value;
    }
    store.set('profile', profile);
    syncConditional();
    renderProfileViews();
  }
  function onEdit(e) {
    const el = e.target.closest('input[data-key], select[data-key]');
    if (!el) return;
    if (el.type === 'radio' && !el.checked) return;
    setField(el.dataset.key, readControl(el));
  }
  document.addEventListener('input', onEdit);
  document.addEventListener('change', e => { if (e.target.matches('select, [type=radio], [type=checkbox]')) onEdit(e); });
  $$('.stepper').forEach(st => st.addEventListener('click', e => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const max = +st.dataset.max || 9;
    const v = Math.max(0, Math.min(max, L.num(profile[st.dataset.key]) + +b.dataset.step));
    setField(st.dataset.key, v);
    st.querySelector('output').textContent = L.num(profile[st.dataset.key]);
  }));

  function renderProfileViews() {
    $$('[data-example]').forEach(el => { el.hidden = !isExample; });
    renderScore();
    renderElig();
  }

  // ---------- 가점 ----------
  function renderScore() {
    const ref = refDate();
    const s = L.calcScore(profile, ref);
    $('#scRef').textContent = `${L.fmtFull(ref)} 기준`;
    $('#scTotal').textContent = s.complete ? s.total : (s.total ? `${s.total}+` : '–');
    const pct = v => `${((v || 0) / 84) * 100}%`;
    $('#barH').style.width = pct(s.house.score);
    $('#barF').style.width = pct(s.family.score);
    $('#barA').style.width = pct(s.account.score);
    $('#scH').textContent = s.house.score == null ? '–' : s.house.score;
    $('#scF').textContent = s.family.score;
    $('#scA').textContent = s.account.score == null ? '–' : s.account.score;
    $('#scHd').textContent = s.house.detail;
    $('#scFd').textContent = s.family.detail;
    $('#scAd').textContent = s.account.detail;
    $('#famSum').innerHTML = `부양가족 <b>${s.family.count}명</b> → <b>${s.family.score}점</b>` +
      (profile.married ? ' <small>(배우자 포함)</small>' : '');

    const t = L.today();
    const nexts = s.nexts.filter(n => n.date > t).slice(0, 4);
    $('#nextUp').innerHTML = nexts.length ? `<h3>가만히 있어도 오르는 점수</h3>` + nexts.map(n => `
      <div class="nx"><span class="nx-date">${L.fmtFull(n.date)}</span><span class="nx-what">${esc(n.what)}</span><span class="nx-gain">+${n.gain}</span></div>`).join('') : '';
  }

  // ---------- 자격 ----------
  function eligCtx() {
    const ri = L.regionInfo(profile.region);
    return { regulated: !!profile.regulated, capital: ri.capital, group: ri.group, groupName: ri.groupName, areaIdx: L.num(profile.area) };
  }
  const CK_ICON = { ok: '✓', no: '✕', warn: '?' };
  const checksHTML = checks => `<ul class="checks-list">${checks.map(c =>
    `<li class="c-${c.s}"><span class="ck ck-${c.s}" aria-hidden="true">${CK_ICON[c.s]}</span><span>${esc(c.t)}</span></li>`).join('')}</ul>`;
  const SP_LABEL = { ok: '신청 가능', maybe: '확인 필요', no: '해당 없음' };
  let lastRankStatus = null;

  function renderElig() {
    const ref = refDate(), mode = prefs.mode, ctx = eligCtx();
    $$('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const r1 = L.rank1(profile, ref, Object.assign({ mode }, ctx));
    const head = { ok: '1순위 가능', maybe: '1순위 확인 필요', no: '아직 2순위' }[r1.status];
    const stampTxt = { ok: '1순위<small>충족</small>', maybe: '확인<small>필요</small>', no: '2순위<small>대상</small>' }[r1.status];
    const ctxText = [
      `${profile.region} 거주`,
      ctx.capital ? '수도권' : '비수도권',
      ctx.regulated ? '규제지역 공고' : '비규제지역 공고',
      mode === 'private' ? `${R.areaNames[ctx.areaIdx]} · 예치금 ${ctx.groupName} 기준` : '납입 회차 기준',
    ].join(' · ');
    const pop = lastRankStatus !== null && lastRankStatus !== r1.status ? ' pop' : '';
    lastRankStatus = r1.status;
    $('#rankCard').innerHTML = `
      <span class="rk-kicker">${mode === 'private' ? '민영주택' : '공공주택'} 일반공급</span>
      <p class="rk-result">${head}</p>
      <p class="rk-ctx">${esc(ctxText)}</p>
      <div class="stamp is-${r1.status}${pop}" aria-hidden="true"><span>${stampTxt}</span></div>
      ${checksHTML(r1.checks)}`;

    const sp = L.specials(profile, ref, mode, ctx);
    renderIncome(sp.inc, mode);
    const order = { ok: 0, maybe: 1, no: 2 };
    const items = sp.list.slice().sort((a, b) => order[a.status] - order[b.status]);
    $('#spList').innerHTML = items.map(s => {
      const firstBad = s.checks.find(c => c.s === 'no') || s.checks.find(c => c.s === 'warn');
      const why = s.status === 'ok' ? '조건을 다 맞췄어' : firstBad ? firstBad.t : '';
      return `<li><details class="sp st-${s.status}" data-sp="${s.key}"${openSp.has(s.key) ? ' open' : ''}>
        <summary><span class="sp-name">${s.name}</span><span class="pill pill-${s.status}">${SP_LABEL[s.status]}</span><span class="sp-why">${esc(why)}</span></summary>
        <div class="sp-body">${checksHTML(s.checks)}${s.hint ? `<p class="sp-hint">${esc(s.hint)}</p>` : ''}</div>
      </details></li>`;
    }).join('');
    $('#hhAuto').textContent = `비우면 ${1 + L.familyCount(profile)}명 (나 + 부양가족)`;
    $('#p-hhSize').placeholder = String(1 + L.familyCount(profile));
    $('#eligFine').textContent = `${R.asOf} 기준 간이 판정이야. 실제 자격은 공고문마다 조금씩 달라서, 청약 전에 꼭 입주자모집공고문과 청약홈에서 확인해. 기관추천·이전기관 특공은 뺐어.`;
  }
  const openSp = new Set();
  $('#spList').addEventListener('toggle', e => {
    const d = e.target.closest('details[data-sp]');
    if (!d) return;
    if (d.open) openSp.add(d.dataset.sp); else openSp.delete(d.dataset.sp);
  }, true);
  $$('#modeSeg button').forEach(b => b.addEventListener('click', () => {
    prefs.mode = b.dataset.mode; savePrefs(); lastRankStatus = null; renderElig();
  }));

  function renderIncome(inc, mode) {
    const box = $('#incomeBox');
    const lim = R.incomeLimit[mode];
    const ticks = Array.from(new Set(Object.values(lim))).sort((a, b) => a - b);
    const max = 200;
    const pos = v => `${Math.min(100, (v / max) * 100)}%`;
    if (inc.pct == null) {
      box.innerHTML = `<p class="ib-line">가구 월소득을 넣으면 도시근로자 평균(${R.incomeYear}년, ${Math.min(inc.size, 6)}인 가구 ${Math.round(inc.base / 10000).toLocaleString('ko-KR')}만원)과 비교해줄게.</p>`;
      return;
    }
    box.innerHTML = `
      <p class="ib-line">${inc.size}인 가구 월 ${L.won(inc.income)} → 도시근로자 평균의 <b>${L.pctText(inc.pct)}</b></p>
      <div class="meter" role="img" aria-label="소득 비율 ${L.pctText(inc.pct)}">
        <div class="meter-track"></div>
        <div class="meter-fill" style="width:${pos(inc.pct)}"></div>
        ${ticks.map((t, i) => `<div class="meter-tick${i % 2 ? ' low' : ''}" style="left:${pos(t)}"><span>${t}%</span></div>`).join('')}
        <div class="meter-me" style="left:${pos(inc.pct)}"></div>
      </div>
      ${inc.size > 6 ? '<p class="fine">7인 이상 가구는 6인 기준으로 계산했어. 공고문 기준을 확인해.</p>' : ''}`;
  }

  // ---------- 공고 ----------
  class ApiError extends Error {
    constructor(status, msg) { super(msg || `HTTP ${status}`); this.status = status; }
  }
  function keyParam(k) {
    k = k.trim();
    return /%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k);
  }
  async function apiGet(path, params) {
    const qs = Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
    const url = `${L.API_BASE}${path}?${qs}&serviceKey=${keyParam(apiKey)}`;
    let res;
    try { res = await fetch(url); } catch (e) { throw new ApiError(0, 'network'); }
    let body = null;
    try { body = await res.json(); } catch (e) { /* JSON 아님 */ }
    if (!res.ok) throw new ApiError(res.status, body && body.msg);
    return body || {};
  }
  async function apiAll(path, cond) {
    let all = [];
    for (let page = 1; page <= 5; page++) {
      const body = await apiGet(path, Object.assign({ page, perPage: 300 }, cond));
      const data = body.data || [];
      all = all.concat(data);
      const total = body.matchCount != null ? body.matchCount : body.totalCount;
      if (data.length < 300 || (total != null && all.length >= total)) break;
    }
    return all;
  }
  function errorText(e) {
    if (e.status === 0) return '<b>인터넷 연결을 확인해줘.</b><p>연결되면 새로고침을 눌러.</p>';
    if (e.status === 401 || e.status === 403) {
      return `<b>API 키를 확인해줘.</b><p>${esc(e.message)} · 키를 막 발급받았다면 등록까지 1~2시간 걸릴 수 있어. 설정에서 Decoding 키가 맞는지도 봐줘.</p>`;
    }
    if (e.status === 429) return '<b>오늘 조회 한도를 넘었어.</b><p>내일 다시 시도해줘.</p>';
    return `<b>공고를 못 불러왔어.</b><p>${esc(e.message)} · 잠시 후 새로고침해줘.</p>`;
  }

  async function fetchNotices() {
    if (!apiKey || loading) return;
    loading = true; lastError = null; renderNotices();
    const since = L.addDays(L.today(), -prefs.days);
    try {
      const kinds = prefs.kinds.filter(k => L.API_KINDS[k]);
      const results = await Promise.all(kinds.map(kind => {
        const k = L.API_KINDS[kind];
        const s = k.dateFmt === 'compact' ? L.iso(since).replace(/-/g, '') : L.iso(since);
        return apiAll(k.path, { 'cond[RCRIT_PBLANC_DE::GTE]': s });
      }));
      const raw = {};
      kinds.forEach((k, i) => { raw[k] = results[i]; });
      cache = { at: Date.now(), raw };
      store.set('notices', cache);
      notices = L.normalizeAll(raw);
    } catch (e) {
      lastError = e;
    }
    loading = false;
    renderNotices();
    return lastError;
  }

  function sampleRaw() {
    const t = L.today(), D = n => L.iso(L.addDays(t, n));
    const base = { _sample: true, HOUSE_SECD: '01', HOUSE_SECD_NM: 'APT', NSPRC_NM: '' };
    return {
      apt: [
        Object.assign({}, base, {
          HOUSE_MANAGE_NO: 'S1', PBLANC_NO: 'S1', HOUSE_NM: '(예시) 푸른숲마을 하늘채', HOUSE_DTL_SECD: '01', HOUSE_DTL_SECD_NM: '민영',
          SUBSCRPT_AREA_CODE_NM: '경기', HSSPLY_ADRES: '경기도 예시시 숲속로 12 일원', TOT_SUPLY_HSHLDCO: 812,
          RCRIT_PBLANC_DE: D(-4), SPSPLY_RCEPT_BGNDE: D(3), SPSPLY_RCEPT_ENDDE: D(3),
          GNRL_RNK1_CRSPAREA_RCPTDE: D(4), GNRL_RNK1_CRSPAREA_ENDDE: D(4), GNRL_RNK1_ETC_AREA_RCPTDE: D(5), GNRL_RNK1_ETC_AREA_ENDDE: D(5),
          GNRL_RNK2_CRSPAREA_RCPTDE: D(6), GNRL_RNK2_CRSPAREA_ENDDE: D(6), PRZWNER_PRESNATN_DE: D(12),
          CNTRCT_CNCLS_BGNDE: D(24), CNTRCT_CNCLS_ENDDE: D(26), MVN_PREARNGE_YM: '202903',
          SPECLT_RDN_EARTH_AT: 'N', MDAT_TRGET_AREA_SECD: 'N', PARCPRC_ULS_AT: 'N', PBLANC_URL: 'https://www.applyhome.co.kr', MDHS_TELNO: '1600-0000',
        }),
        Object.assign({}, base, {
          HOUSE_MANAGE_NO: 'S2', PBLANC_NO: 'S2', HOUSE_NM: '(예시) 한강변 리버파크', HOUSE_DTL_SECD: '01', HOUSE_DTL_SECD_NM: '민영',
          SUBSCRPT_AREA_CODE_NM: '서울', HSSPLY_ADRES: '서울특별시 예시구 강변로 300', TOT_SUPLY_HSHLDCO: 1204,
          RCRIT_PBLANC_DE: D(-8), SPSPLY_RCEPT_BGNDE: D(-1), SPSPLY_RCEPT_ENDDE: D(-1),
          GNRL_RNK1_CRSPAREA_RCPTDE: D(0), GNRL_RNK1_CRSPAREA_ENDDE: D(0), GNRL_RNK1_ETC_AREA_RCPTDE: D(1), GNRL_RNK1_ETC_AREA_ENDDE: D(1),
          GNRL_RNK2_CRSPAREA_RCPTDE: D(2), GNRL_RNK2_CRSPAREA_ENDDE: D(2), PRZWNER_PRESNATN_DE: D(8),
          CNTRCT_CNCLS_BGNDE: D(19), CNTRCT_CNCLS_ENDDE: D(21), MVN_PREARNGE_YM: '202811',
          SPECLT_RDN_EARTH_AT: 'Y', MDAT_TRGET_AREA_SECD: 'Y', PARCPRC_ULS_AT: 'Y', PBLANC_URL: 'https://www.applyhome.co.kr', MDHS_TELNO: '1600-0000',
        }),
        Object.assign({}, base, {
          HOUSE_MANAGE_NO: 'S3', PBLANC_NO: 'S3', HOUSE_NM: '(예시) 행복도시 공공분양 A3블록', HOUSE_DTL_SECD: '03', HOUSE_DTL_SECD_NM: '국민',
          SUBSCRPT_AREA_CODE_NM: '세종', HSSPLY_ADRES: '세종특별자치시 예시동 A3블록', TOT_SUPLY_HSHLDCO: 640,
          RCRIT_PBLANC_DE: D(-20), SPSPLY_RCEPT_BGNDE: D(-10), SPSPLY_RCEPT_ENDDE: D(-8),
          GNRL_RNK1_CRSPAREA_RCPTDE: D(-7), GNRL_RNK1_CRSPAREA_ENDDE: D(-7), PRZWNER_PRESNATN_DE: D(2),
          CNTRCT_CNCLS_BGNDE: D(15), CNTRCT_CNCLS_ENDDE: D(17), MVN_PREARNGE_YM: '202906',
          SPECLT_RDN_EARTH_AT: 'N', MDAT_TRGET_AREA_SECD: 'N', PARCPRC_ULS_AT: 'Y', PBLANC_URL: 'https://www.applyhome.co.kr', MDHS_TELNO: '1600-0000',
        }),
      ],
    };
  }
  const SAMPLE_MODELS = {
    S1: [
      { HOUSE_TY: '059.9800A', SUPLY_AR: '84.10', SUPLY_HSHLDCO: 120, SPSPLY_HSHLDCO: 160, NWWDS_HSHLDCO: 40, LFE_FRST_HSHLDCO: 32, NWBB_HSHLDCO: 28, MNYCH_HSHLDCO: 28, OLD_PARNTS_SUPORT_HSHLDCO: 8, INSTT_RECOMEND_HSHLDCO: 24, LTTOT_TOP_AMOUNT: '52800' },
      { HOUSE_TY: '084.9700A', SUPLY_AR: '112.35', SUPLY_HSHLDCO: 230, SPSPLY_HSHLDCO: 250, NWWDS_HSHLDCO: 62, LFE_FRST_HSHLDCO: 50, NWBB_HSHLDCO: 45, MNYCH_HSHLDCO: 45, OLD_PARNTS_SUPORT_HSHLDCO: 13, INSTT_RECOMEND_HSHLDCO: 35, LTTOT_TOP_AMOUNT: '68900' },
      { HOUSE_TY: '101.8900B', SUPLY_AR: '134.20', SUPLY_HSHLDCO: 52, SPSPLY_HSHLDCO: 0, LTTOT_TOP_AMOUNT: '83500' },
    ],
    S2: [
      { HOUSE_TY: '059.9100A', SUPLY_AR: '83.50', SUPLY_HSHLDCO: 210, SPSPLY_HSHLDCO: 230, NWWDS_HSHLDCO: 57, LFE_FRST_HSHLDCO: 46, NWBB_HSHLDCO: 40, MNYCH_HSHLDCO: 40, OLD_PARNTS_SUPORT_HSHLDCO: 12, INSTT_RECOMEND_HSHLDCO: 35, LTTOT_TOP_AMOUNT: '129000' },
      { HOUSE_TY: '084.9800A', SUPLY_AR: '113.10', SUPLY_HSHLDCO: 380, SPSPLY_HSHLDCO: 300, NWWDS_HSHLDCO: 75, LFE_FRST_HSHLDCO: 60, NWBB_HSHLDCO: 52, MNYCH_HSHLDCO: 52, OLD_PARNTS_SUPORT_HSHLDCO: 16, INSTT_RECOMEND_HSHLDCO: 45, LTTOT_TOP_AMOUNT: '172000' },
      { HOUSE_TY: '114.9600A', SUPLY_AR: '149.80', SUPLY_HSHLDCO: 84, SPSPLY_HSHLDCO: 0, LTTOT_TOP_AMOUNT: '235000' },
    ],
    S3: [
      { HOUSE_TY: '059.9500A', SUPLY_AR: '80.90', SUPLY_HSHLDCO: 96, SPSPLY_HSHLDCO: 224, NWWDS_HSHLDCO: 64, LFE_FRST_HSHLDCO: 56, NWBB_HSHLDCO: 40, MNYCH_HSHLDCO: 24, OLD_PARNTS_SUPORT_HSHLDCO: 8, INSTT_RECOMEND_HSHLDCO: 32, LTTOT_TOP_AMOUNT: '33400' },
      { HOUSE_TY: '084.9400A', SUPLY_AR: '111.60', SUPLY_HSHLDCO: 120, SPSPLY_HSHLDCO: 200, NWWDS_HSHLDCO: 56, LFE_FRST_HSHLDCO: 50, NWBB_HSHLDCO: 34, MNYCH_HSHLDCO: 22, OLD_PARNTS_SUPORT_HSHLDCO: 8, INSTT_RECOMEND_HSHLDCO: 30, LTTOT_TOP_AMOUNT: '45200' },
    ],
  };
  const sampleNotices = L.normalizeAll(sampleRaw());
  const currentNotices = () => (apiKey ? notices : sampleNotices);

  function baseList() {
    const t = L.today();
    let list = currentNotices().map(n => ({ n, st: L.noticeStatus(n, t) }));
    if (prefs.regions.length) list = list.filter(x => prefs.regions.includes(x.n.region));
    return list;
  }

  function renderNotices() {
    const t = L.today();
    $('#todayLabel').textContent = `${L.fmtFull(t)} (${L.weekday(t)})`;
    $('#noticeSetup').hidden = !!apiKey;
    const err = $('#noticeError');
    err.hidden = !lastError;
    if (lastError) err.innerHTML = errorText(lastError);
    $('#refreshBtn').classList.toggle('spinning', loading);
    $('#refreshBtn').disabled = loading || !apiKey;

    if (!apiKey) $('#noticeMeta').textContent = '예시 공고 3건 · API 키를 넣으면 진짜 공고로 바뀌어';
    else if (loading && !cache) $('#noticeMeta').textContent = '청약홈에서 공고를 불러오는 중…';
    else if (cache) {
      const mins = Math.round((Date.now() - cache.at) / 60000);
      const ago = mins < 1 ? '방금' : mins < 60 ? `${mins}분 전` : mins < 1440 ? `${Math.round(mins / 60)}시간 전` : `${Math.round(mins / 1440)}일 전`;
      $('#noticeMeta').textContent = `${loading ? '업데이트 중… · ' : ''}${ago} 업데이트 · 최근 ${prefs.days}일 공고 ${notices.length}건`;
    } else $('#noticeMeta').textContent = '';

    let list = baseList();

    // 지역 칩: 관심 지역이 있으면 그 지역들, 없으면 공고가 많은 순
    const counts = {};
    list.forEach(x => { counts[x.n.region] = (counts[x.n.region] || 0) + 1; });
    const chipRegions = prefs.regions.length ? prefs.regions.slice()
      : Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 8);
    if (prefs.region && !chipRegions.includes(prefs.region)) prefs.region = '';
    $('#regionChips').innerHTML = [`<button type="button" class="chip" data-region="" aria-pressed="${!prefs.region}">${prefs.regions.length ? '관심 지역 전체' : '전국'}</button>`]
      .concat(chipRegions.map(r => `<button type="button" class="chip" data-region="${esc(r)}" aria-pressed="${prefs.region === r}">${esc(r)}<span class="cnt">${counts[r] || 0}</span></button>`)).join('');
    if (prefs.region) list = list.filter(x => x.n.region === prefs.region);

    // 다가오는 일정
    const ag = L.agenda(list.filter(x => x.st.key !== 'done').map(x => x.n), t, 21);
    const byDay = new Map();
    ag.forEach(a => { const k = L.iso(a.date); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(a); });
    $('#agenda').innerHTML = byDay.size ? Array.from(byDay.entries()).slice(0, 10).map(([k, items]) => {
      const d = L.parseD(k), isToday = L.daysBetween(t, d) === 0;
      return `<li class="ag-day${isToday ? ' is-today' : ''}">
        <div class="ag-date"><b>${d.getDate()}</b><span>${isToday ? '오늘' : `${d.getMonth() + 1}월 ${L.weekday(d)}`}</span></div>
        <ul class="ag-items">${items.map(a => {
          const range = a.e.end > a.e.start ? ` ~${L.fmtShort(a.e.end)}` : '';
          const what = a.ongoing ? `${a.e.label} 접수 중 (~${L.fmtShort(a.e.end)})`
            : a.e.type === 'r' ? `${a.e.label} 접수${range}` : `${a.e.label}${range}`;
          const open = a.e.type === 'r' && (a.ongoing || isToday);
          return `<li class="ag-item"><span class="ag-what${open ? ' is-open' : ''}">${esc(what)}</span><button type="button" class="ag-name" data-open="${esc(a.n.id)}">${esc(a.n.name)}</button></li>`;
        }).join('')}</ul></li>`;
    }).join('') : `<li class="agenda-empty">앞으로 3주 안에 잡힌 일정이 없어.</li>`;

    // 공고 목록
    $$('#noticeFilter button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === prefs.filter)));
    if (prefs.filter === 'active') list = list.filter(x => x.st.key !== 'done');
    if (prefs.filter === 'star') list = list.filter(x => stars.has(x.n.id));
    L.sortNotices(list);
    if (prefs.filter !== 'star') list.sort((a, b) => (stars.has(b.n.id) ? 1 : 0) - (stars.has(a.n.id) ? 1 : 0));

    $('#noticeList').innerHTML = list.length ? list.slice(0, 120).map(({ n, st }) => noticeCard(n, st, t)).join('')
      : `<li class="notices-empty">${loading ? '불러오는 중…' : prefs.filter === 'star' ? '★를 눌러 관심 공고를 모아봐.' : '조건에 맞는 공고가 없어.'}</li>`;
  }

  function flagsHTML(n) {
    const f = [];
    if (n.flags.spec) f.push('<span class="flag flag-hot">투기과열</span>');
    if (n.flags.adj) f.push('<span class="flag flag-hot">조정대상</span>');
    if (n.flags.cap) f.push('<span class="flag">분양가상한제</span>');
    return f.length ? `<span class="flags">${f.join('')}</span>` : '';
  }
  function noticeCard(n, st, t) {
    const steps = n.events.filter(e => e.key !== 'r1e' && e.key !== 'r2').slice(0, 5).map(e => {
      const cls = e.end < t ? 'past' : e.start <= t && t <= e.end ? 'now' : '';
      return `<li class="step ${cls}"><span>${e.short}</span><b>${L.fmtShort(e.start)}</b></li>`;
    }).join('');
    const starred = stars.has(n.id);
    return `<li class="ncard st-${st.key}">
      <div class="nc-main" role="button" tabindex="0" data-open="${esc(n.id)}">
        <div class="nc-top"><span class="pill pill-${st.key}">${esc(st.label)}</span>${st.badge ? `<span class="dday">${st.badge}</span>` : ''}${n.sample ? '<span class="pill pill-sample">예시</span>' : ''}</div>
        <h3 class="nc-name">${esc(n.name)}</h3>
        <p class="nc-sub">${esc(n.region)} · ${esc(n.typeLabel)}${n.total ? ` · ${n.total.toLocaleString('ko-KR')}세대` : ''}</p>
        ${flagsHTML(n)}
        ${steps ? `<ol class="steps">${steps}</ol>` : ''}
      </div>
      <button type="button" class="star" data-star="${esc(n.id)}" aria-pressed="${starred}" aria-label="관심 공고${starred ? ' 해제' : ''}">★</button>
    </li>`;
  }

  $('#regionChips').addEventListener('click', e => {
    const b = e.target.closest('[data-region]');
    if (!b) return;
    prefs.region = b.dataset.region; savePrefs(); renderNotices();
  });
  $$('#noticeFilter button').forEach(b => b.addEventListener('click', () => { prefs.filter = b.dataset.filter; savePrefs(); renderNotices(); }));
  $('#refreshBtn').addEventListener('click', () => fetchNotices());
  document.addEventListener('click', e => {
    const s = e.target.closest('[data-star]');
    if (s) {
      const id = s.dataset.star;
      if (stars.has(id)) stars.delete(id); else stars.add(id);
      store.set('stars', Array.from(stars));
      renderNotices();
      return;
    }
    const o = e.target.closest('[data-open]');
    if (o) openSheet(o.dataset.open);
  });
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.nc-main[data-open]')) {
      e.preventDefault();
      openSheet(e.target.dataset.open);
    }
  });

  // ---------- 공고 상세 ----------
  const sheet = $('#sheet');
  $('#sheetClose').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  let sheetId = null;

  function openSheet(id) {
    const n = currentNotices().find(x => x.id === id);
    if (!n) return;
    sheetId = id;
    const t = L.today(), st = L.noticeStatus(n, t);
    $('#shKicker').innerHTML = `${esc(n.region)} · ${esc(n.typeLabel)}${n.sample ? ' · 예시' : ''}`;
    $('#shTitle').textContent = n.name;
    $('#shAddr').textContent = n.address;

    const rows = [];
    if (n.notice) rows.push({ k: '모집공고', d: n.notice, e: n.notice });
    n.events.forEach(e => rows.push({ k: e.label, d: e.start, e: e.end }));
    const schedRows = rows.map(r => {
      const cls = r.e < t ? 'past' : r.d <= t && t <= r.e ? 'now' : '';
      const val = r.e > r.d ? `${L.fmtDay(r.d)} ~ ${L.fmtDay(r.e)}` : L.fmtDay(r.d);
      return `<tr class="${cls}"><th scope="row">${esc(r.k)}</th><td>${val}</td></tr>`;
    }).join('') + (n.moveIn ? `<tr><th scope="row">입주 예정</th><td>${esc(n.moveIn)}</td></tr>` : '');

    const links = [];
    if (n.url) links.push(`<a class="btn btn-primary" href="${esc(n.url)}" target="_blank" rel="noopener">청약홈에서 공고 보기</a>`);
    if (n.homepage) links.push(`<a class="btn" href="${esc(/^https?:/i.test(n.homepage) ? n.homepage : 'http://' + n.homepage)}" target="_blank" rel="noopener">분양 홈페이지</a>`);

    $('#shBody').innerHTML = `
      <div class="nc-top"><span class="pill pill-${st.key}">${esc(st.label)}</span>${st.badge ? `<span class="dday">${st.badge}</span>` : ''}${flagsHTML(n)}</div>
      <section class="sh-sec"><h3>일정</h3><table class="sched"><tbody>${schedRows}</tbody></table></section>
      <section class="sh-sec" id="shModels"><h3>주택형</h3><p class="loading">불러오는 중…</p></section>
      <section class="sh-sec" id="shMine"></section>
      <section class="sh-sec links">${links.join('')}${n.phone ? `<p class="phone">문의 ${esc(n.phone)}${n.builder ? ` · ${esc(n.builder)}` : ''}</p>` : ''}</section>`;
    renderMine(n, null);
    if (!sheet.open) sheet.showModal();
    $('#shBody').scrollTop = 0;
    loadModels(n);
  }

  async function loadModels(n) {
    const kind = L.API_KINDS[n.kind];
    let models = modelCache.get(n.id);
    try {
      if (!models) {
        if (n.sample) models = (SAMPLE_MODELS[n.houseNo] || []).map(L.normModel);
        else {
          const body = await apiGet(kind.mdl, { page: 1, perPage: 100, 'cond[HOUSE_MANAGE_NO::EQ]': n.houseNo, 'cond[PBLANC_NO::EQ]': n.pblancNo });
          models = (body.data || []).map(L.normModel).sort((a, b) => a.area - b.area);
        }
        modelCache.set(n.id, models);
      }
    } catch (e) {
      if (sheetId === n.id) $('#shModels').innerHTML = `<h3>주택형</h3><p class="loading">주택형 정보를 못 불러왔어. 청약홈 공고에서 확인해줘.</p>`;
      return;
    }
    if (sheetId !== n.id || !sheet.open) return;
    renderModels(n, models);
    renderMine(n, models);
  }

  function renderModels(n, models) {
    const box = $('#shModels');
    if (!models.length) { box.innerHTML = '<h3>주택형</h3><p class="loading">주택형 정보가 없어.</p>'; return; }
    const showDep = n.checksRank && !n.isPublic;
    const group = L.regionInfo(profile.region).group, dep = L.numOrNull(profile.deposit);
    const head = `<tr><th>주택형</th><th>공급면적</th><th>일반</th><th>특공</th><th>최고가</th>${showDep ? '<th>내 예치금</th>' : ''}</tr>`;
    const body = models.map(m => {
      let depCell = '';
      if (showDep) {
        const need = R.deposit[group][L.areaIndex(m.area)];
        depCell = dep == null ? '<td class="n">–</td>' : `<td class="${dep >= need ? 'y' : 'n'}">${dep >= need ? '충족' : `${need.toLocaleString('ko-KR')}만 필요`}</td>`;
      }
      return `<tr><td><b>${esc(m.label)}</b></td><td>${m.supplyArea ? `${m.supplyArea.toFixed(2)}㎡` : '–'}</td><td>${m.general}</td><td>${m.special}</td><td>${L.price(m.price)}</td>${depCell}</tr>`;
    }).join('');
    const spKeys = ['신혼부부', '생애최초', '신생아', '다자녀', '노부모', '청년', '기관추천', '이전기관', '기타']
      .filter(k => models.some(m => m.sp[k] > 0));
    const spTable = spKeys.length ? `
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>특공 세대</th>${spKeys.map(k => `<th>${k}</th>`).join('')}</tr></thead>
      <tbody>${models.filter(m => m.special > 0).map(m => `<tr><td><b>${esc(m.label)}</b></td>${spKeys.map(k => `<td>${m.sp[k] || '–'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
    box.innerHTML = `<h3>주택형</h3>
      <div class="tbl-wrap"><table class="tbl"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      ${spTable}
      <p class="fine">주택형 숫자는 전용면적(㎡)이야. 최고가는 해당 타입 최고 분양가.</p>`;
  }

  function renderMine(n, models) {
    const box = $('#shMine');
    if (!n.checksRank) {
      box.innerHTML = '';
      return;
    }
    const t = L.today();
    const mode = n.isPublic ? 'public' : 'private';
    const regulated = n.flags.spec || n.flags.adj;
    const capital = R.capital.includes(n.region);
    const ri = L.regionInfo(profile.region);
    const minArea = models && models.length ? Math.min.apply(null, models.map(m => m.area)) : 85;
    const r1 = L.rank1(profile, t, { mode, regulated, capital, group: ri.group, areaIdx: L.areaIndex(minArea) });
    const sc = L.calcScore(profile, t);
    const sp = L.specials(profile, t, mode, { regulated, capital, group: ri.group, areaIdx: 0 });
    const can = sp.list.filter(s => s.status !== 'no').map(s => `${s.name}${s.status === 'maybe' ? '(확인)' : ''}`);
    const local = profile.region === n.region;
    const label = { ok: '1순위로 넣을 수 있어', maybe: '1순위인지 확인이 필요해', no: '이 공고에선 2순위야' }[r1.status];
    box.innerHTML = `<h3>내 조건으로 보면${isExample ? ' <small>(예시 값)</small>' : ''}</h3>
      <div class="mine">
        <div class="mine-score"><b>${sc.complete ? sc.total : '–'}</b><span>/ 84점 · ${mode === 'private' ? '가점제 물량에 쓰는 점수' : '공공주택 일반공급은 가점 대신 납입 회차·저축총액 순'}</span></div>
        <p class="ib-line"><b>${label}</b> · ${local ? '해당지역 거주 (거주기간 요건은 공고문 확인)' : `기타지역 신청 (${esc(n.region)} 거주자가 먼저)`}</p>
        ${checksHTML(r1.checks)}
        <p class="ib-line">특별공급: ${can.length ? esc(can.join(', ')) : '맞는 유형이 없어 보여'}</p>
      </div>`;
  }

  // ---------- 설정 ----------
  function renderSettings() {
    $('#apiKey').value = apiKey;
    $('#prefRegions').innerHTML = R.regions.map(r =>
      `<button type="button" class="chip" data-pref-region="${r}" aria-pressed="${prefs.regions.includes(r)}">${r}</button>`).join('');
    $('#prefKinds').innerHTML = Object.keys(L.API_KINDS).map(k =>
      `<label class="check"><input type="checkbox" id="kind-${k}" data-kind="${k}"${prefs.kinds.includes(k) ? ' checked' : ''}><span>${L.API_KINDS[k].label}</span></label>`).join('');
    $('#prefDays').value = String(prefs.days);
    $('#rulesAsOf').textContent = `가점표, 1순위 요건, 특별공급 소득 기준은 ${R.asOf} 기준이야. 도시근로자 월평균소득은 ${R.incomeYear}년 표를 썼어.`;
    $('#sources').innerHTML = R.sources.map(s => `<li><a href="${s.url}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('');
    renderInstall();
  }
  $('#prefRegions').addEventListener('click', e => {
    const b = e.target.closest('[data-pref-region]');
    if (!b) return;
    const r = b.dataset.prefRegion;
    prefs.regions = prefs.regions.includes(r) ? prefs.regions.filter(x => x !== r) : prefs.regions.concat(r);
    prefs.regions.sort((a, b2) => R.regions.indexOf(a) - R.regions.indexOf(b2));
    prefs.region = '';
    savePrefs();
    b.setAttribute('aria-pressed', String(prefs.regions.includes(r)));
    renderNotices();
  });
  $('#prefKinds').addEventListener('change', e => {
    const c = e.target.closest('[data-kind]');
    if (!c) return;
    prefs.kinds = $$('#prefKinds [data-kind]').filter(x => x.checked).map(x => x.dataset.kind);
    if (!prefs.kinds.length) { prefs.kinds = ['apt']; renderSettings(); }
    savePrefs();
    fetchNotices();
  });
  $('#prefDays').addEventListener('change', e => { prefs.days = +e.target.value; savePrefs(); fetchNotices(); });

  $('#apiKeyShow').addEventListener('click', () => {
    const i = $('#apiKey'), show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('#apiKeyShow').textContent = show ? '숨기기' : '보기';
  });
  $('#apiKeySave').addEventListener('click', async () => {
    const v = $('#apiKey').value.trim();
    const line = $('#apiKeyStatus');
    if (!v) { line.className = 'status-line is-err'; line.textContent = '키를 붙여넣어줘.'; return; }
    if (loading) { line.className = 'status-line'; line.textContent = '공고를 받는 중이야. 끝나면 다시 눌러줘.'; return; }
    apiKey = v; store.set('apiKey', apiKey);
    line.className = 'status-line'; line.textContent = '청약홈에 연결하는 중…';
    cache = null; notices = [];
    const err = await fetchNotices();
    if (err) {
      line.className = 'status-line is-err';
      line.textContent = err.status === 0 ? '인터넷 연결을 확인해줘.' : `연결 실패 (${err.status}) · ${err.message.replace(/\.\s*$/, '')}. 막 발급받은 키라면 1~2시간 뒤 다시 눌러봐.`;
    } else {
      line.className = 'status-line is-ok';
      line.textContent = `연결됐어. 최근 ${prefs.days}일 공고 ${notices.length}건을 받았어.`;
    }
  });
  $('#apiKeyClear').addEventListener('click', () => {
    apiKey = ''; store.set('apiKey', ''); cache = null; notices = []; lastError = null;
    store.set('notices', null);
    $('#apiKey').value = '';
    $('#apiKeyStatus').className = 'status-line'; $('#apiKeyStatus').textContent = '키를 지웠어. 공고 탭은 예시로 돌아가.';
    renderNotices();
  });

  // 설치
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; renderInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; renderInstall(); });
  function renderInstall() {
    const box = $('#installBox');
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) { box.innerHTML = '<p class="hint">앱으로 실행 중이야. 홈 화면 아이콘으로 열면 돼.</p>'; return; }
    box.innerHTML = `${installEvt ? '<button class="btn btn-primary" type="button" id="installBtn">홈 화면에 설치</button>' : ''}
      <ol class="howto-list hint">
        <li><b>크롬</b>: 오른쪽 위 ⋮ → <b>홈 화면에 추가</b> → 설치</li>
        <li><b>삼성 인터넷</b>: 아래 ≡ → <b>현재 페이지 추가</b> → <b>홈 화면</b></li>
      </ol>`;
    const btn = $('#installBtn');
    if (btn) btn.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; renderInstall(); });
  }

  // 초기화 (페이지 안에서 확인)
  $('#resetBox').addEventListener('click', e => {
    const box = $('#resetBox');
    if (e.target.id === 'resetAsk') {
      box.innerHTML = `<div class="confirm"><p>내 정보, API 키, 관심 공고가 전부 지워져. 정말 지울까?</p>
        <div class="btn-row"><button class="btn btn-danger" type="button" id="resetYes">지우기</button><button class="btn" type="button" id="resetNo">취소</button></div></div>`;
    } else if (e.target.id === 'resetYes') {
      store.clearAll();
      location.reload();
    } else if (e.target.id === 'resetNo') {
      box.innerHTML = '<button class="btn btn-danger" type="button" id="resetAsk">모든 데이터 지우기</button>';
    }
  });

  // ---------- 시작 ----------
  $('#p-region').innerHTML = R.regions.map(r => `<option value="${r}">${r}</option>`).join('');
  $('#p-area').innerHTML = R.areaNames.map((a, i) => `<option value="${i}">${a}</option>`).join('');
  fillForms();
  renderProfileViews();
  renderSettings();
  renderNotices();
  const TABS = ['notice', 'score', 'elig', 'settings'];
  const hash = location.hash.replace('#', '');
  showTab(TABS.includes(hash) ? hash : prefs.tab);
  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#', '');
    if (TABS.includes(h)) showTab(h);
  });

  // 공고는 3시간 넘게 지났으면 자동 새로고침
  if (apiKey && (!cache || Date.now() - cache.at > 3 * 3600 * 1000)) fetchNotices();
  // 날짜가 바뀌면 D-day 다시 계산
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    renderNotices(); renderScore(); renderElig();
    if (apiKey && cache && Date.now() - cache.at > 3 * 3600 * 1000) fetchNotices();
  });

  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
