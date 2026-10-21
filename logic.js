/*
 * 청약 계산 로직 — 화면(DOM)과 상관없는 순수 함수만 모아둠.
 * 가점 계산, 1순위·특별공급 판정, 청약홈 API 응답 정리, 공고 상태 계산.
 */
(function (root) {
  'use strict';
  const R = typeof module === 'object' && module.exports ? require('./rules.js') : root.RULES;

  // ---------- 날짜 ----------
  const pad = n => String(n).padStart(2, '0');
  const WD = '일월화수목금토';

  function parseD(s) {
    if (!s) return null;
    const m = String(s).trim().match(/^(\d{4})-?(\d{2})-?(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  const addYears = (d, n) => new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  function fullMonths(a, b) {
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) m--;
    return m;
  }
  const daysBetween = (a, b) => Math.round((b - a) / 864e5);
  const fmtShort = d => `${d.getMonth() + 1}.${pad(d.getDate())}`;
  const fmtDay = d => `${d.getMonth() + 1}.${pad(d.getDate())} (${WD[d.getDay()]})`;
  const fmtFull = d => `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  const weekday = d => WD[d.getDay()];
  function ym(months) {
    const y = Math.floor(months / 12), m = months % 12;
    if (!y) return `${m}개월`;
    return m ? `${y}년 ${m}개월` : `${y}년`;
  }

  // ---------- 숫자 ----------
  const num = v => (v === '' || v == null || isNaN(+v) ? 0 : +v);
  const numOrNull = v => (v === '' || v == null || isNaN(+v) ? null : +v);
  const won = man => `${Math.round(man).toLocaleString('ko-KR')}만원`;
  function price(man) {
    if (!man) return '–';
    const eok = Math.floor(man / 10000), rest = Math.round(man % 10000);
    if (!eok) return `${rest.toLocaleString('ko-KR')}만`;
    return rest ? `${eok}억 ${rest.toLocaleString('ko-KR')}만` : `${eok}억`;
  }

  // ---------- 프로필 ----------
  const EMPTY_PROFILE = {
    birth: '', married: false, marriage: '',
    house: 'never', noHouseSince: '',
    parents: 0, kidsMinor: 0, kidsAdult: 0,
    join: '', spouseJoin: '', refDate: '',
    region: '서울', head: true, payCount: '', deposit: '',
    won5y: false, newborn: false, parent65: false, dual: false, tax5: false,
    hhSize: '', income: '', area: 0, regulated: false,
  };
  const EXAMPLE_PROFILE = Object.assign({}, EMPTY_PROFILE, {
    birth: '1992-05-14', married: true, marriage: '2021-09-25',
    join: '2016-03-02', spouseJoin: '2019-07-10',
    kidsMinor: 1, newborn: true, dual: true, tax5: true,
    region: '경기', payCount: 96, deposit: 1150, income: 720,
  });

  // ---------- 가점 ----------
  function houseScore(p, ref) {
    if (p.house === 'now') return { score: 0, detail: '지금 집이 있으면 0점' };
    const birth = parseD(p.birth);
    if (!birth) return { score: null, detail: '생년월일을 넣으면 계산돼' };
    const age30 = addYears(birth, 30);
    const mar = p.married ? parseD(p.marriage) : null;
    let start = age30, basis = '만 30세부터';
    if (mar && mar < age30) { start = mar; basis = '혼인신고일부터'; }
    if (p.house === 'past') {
      const s = parseD(p.noHouseSince);
      if (!s) return { score: null, detail: '무주택이 된 날을 넣으면 계산돼' };
      if (s > start) { start = s; basis = '무주택이 된 날부터'; }
    }
    if (ref < start) {
      const detail = !p.married && ref < age30 ? '만 30세 미만 미혼은 0점' : '무주택기간이 아직 시작 전이야';
      return { score: 0, detail, next: { date: start, gain: 2, what: '무주택기간 시작' } };
    }
    const months = fullMonths(start, ref), years = Math.floor(months / 12);
    const score = Math.min(32, 2 * (years + 1));
    const r = { score, detail: `${basis} ${ym(months)}` };
    if (score < 32) r.next = { date: addYears(start, years + 1), gain: 2, what: `무주택기간 ${years + 1}년` };
    return r;
  }

  const familyCount = p => (p.married ? 1 : 0) + num(p.parents) + num(p.kidsMinor) + num(p.kidsAdult);
  function familyScore(p) {
    const n = familyCount(p);
    return { score: Math.min(35, 5 + 5 * Math.min(n, 6)), count: n, detail: n ? `부양가족 ${n}명` : '부양가족 0명이어도 기본 5점' };
  }

  // 본인: 6개월 미만 1점, 1년 미만 2점, 이후 1년마다 +1점, 15년 이상 17점
  const accountPoints = m => (m < 6 ? 1 : m < 12 ? 2 : Math.min(17, Math.floor(m / 12) + 2));
  // 배우자: 가입기간의 50% 인정, 최대 3점 → 1년 미만 1점, 2년 미만 2점, 2년 이상 3점
  const spousePoints = m => (m < 12 ? 1 : m < 24 ? 2 : 3);

  function accountScore(p, ref) {
    const j = parseD(p.join);
    if (!j) return { score: null, detail: '통장 가입일을 넣으면 계산돼' };
    if (j > ref) return { score: null, detail: '가입일이 기준일보다 뒤야' };
    const m = fullMonths(j, ref), own = accountPoints(m);
    const sj = p.married ? parseD(p.spouseJoin) : null;
    let sp = 0, sm = null;
    if (sj && sj <= ref) { sm = fullMonths(sj, ref); sp = spousePoints(sm); }
    const score = Math.min(17, own + sp);
    const r = { score, own, spouse: sp, detail: `가입 ${ym(m)} · 본인 ${own}점` + (sj ? ` + 배우자 ${sp}점` : ''), nexts: [] };
    if (score < 17) {
      if (own < 17) {
        const nm = m < 6 ? 6 : m < 12 ? 12 : (Math.floor(m / 12) + 1) * 12;
        r.nexts.push({ date: addMonths(j, nm), gain: 1, what: `통장 가입 ${ym(nm)}` });
      }
      if (sm != null && sp < 3) {
        const nm = sm < 12 ? 12 : 24;
        r.nexts.push({ date: addMonths(sj, nm), gain: 1, what: `배우자 통장 ${nm / 12}년` });
      }
    }
    return r;
  }

  function calcScore(p, ref) {
    const house = houseScore(p, ref), family = familyScore(p), account = accountScore(p, ref);
    const parts = [house.score, family.score, account.score];
    const complete = parts.every(v => v != null);
    const total = parts.reduce((a, v) => a + (v || 0), 0);
    const nexts = [];
    if (house.next) nexts.push(house.next);
    (account.nexts || []).forEach(n => nexts.push(n));
    nexts.sort((a, b) => a.date - b.date);
    return { house, family, account, total, complete, nexts };
  }

  // ---------- 1순위 · 특별공급 ----------
  function regionInfo(region) {
    const group = R.depositGroup[region] || 'C';
    return { capital: R.capital.includes(region), group, groupName: R.depositGroupName[group] };
  }
  const areaIndex = a => (a <= 85 ? 0 : a <= 102 ? 1 : a <= 135 ? 2 : 3);
  const needMonths = (regulated, capital) =>
    regulated ? R.rank1Months.regulated : capital ? R.rank1Months.capital : R.rank1Months.local;
  const needPayments = (regulated, capital) =>
    regulated ? R.rank1Payments.regulated : capital ? R.rank1Payments.capital : R.rank1Payments.local;

  // 판정 한 줄: s = ok(충족) | no(미충족) | warn(확인 필요·조건부)
  const ck = (s, t) => ({ s, t });
  const yes = (cond, t) => ck(cond ? 'ok' : 'no', t);
  function statusOf(checks) {
    if (checks.some(c => c.s === 'no')) return 'no';
    if (checks.some(c => c.s === 'warn')) return 'maybe';
    return 'ok';
  }
  function joinMonths(p, ref) {
    const j = parseD(p.join);
    return j && j <= ref ? fullMonths(j, ref) : null;
  }

  // opt: { mode: 'private'|'public', regulated, capital, group, areaIdx }
  function rank1(p, ref, opt) {
    const checks = [];
    const m = joinMonths(p, ref), need = needMonths(opt.regulated, opt.capital);
    checks.push(m == null
      ? ck('warn', `통장 가입 ${ym(need)} 이상 · 가입일을 넣어줘`)
      : yes(m >= need, `통장 가입 ${ym(need)} 이상 (지금 ${ym(m)})`));
    if (opt.mode === 'private') {
      const needDep = R.deposit[opt.group][opt.areaIdx], dep = numOrNull(p.deposit);
      checks.push(dep == null
        ? ck('warn', `예치금 ${won(needDep)} 이상 · 예치금을 넣어줘`)
        : yes(dep >= needDep, `예치금 ${won(needDep)} 이상 (지금 ${won(dep)})`));
    } else {
      const needN = needPayments(opt.regulated, opt.capital), n = numOrNull(p.payCount);
      checks.push(n == null
        ? ck('warn', `납입 ${needN}회 이상 · 납입 회차를 넣어줘`)
        : yes(n >= needN, `납입 ${needN}회 이상 (지금 ${n}회)`));
      checks.push(yes(p.house !== 'now', '세대 전원 무주택'));
    }
    if (opt.regulated) {
      checks.push(yes(!!p.head, '세대주'));
      checks.push(yes(!p.won5y, '세대 전원 5년 안에 당첨된 적 없음'));
      if (opt.mode === 'private' && p.house === 'now') checks.push(ck('warn', '2주택 이상 세대는 1순위 불가'));
    }
    return { status: statusOf(checks), checks, needMonths: need };
  }

  function householdSize(p) {
    const v = numOrNull(p.hhSize);
    return v && v > 0 ? v : 1 + familyCount(p);
  }
  function incomeInfo(p) {
    const size = householdSize(p), inc = numOrNull(p.income);
    const base = R.income100[Math.min(6, Math.max(1, size))];
    return { size, income: inc, base, pct: inc == null ? null : (inc * 10000) / base * 100 };
  }
  const pctText = v => `${(Math.round(v * 10) / 10).toLocaleString('ko-KR')}%`;
  function incomeCheck(info, limit, label, alt) {
    if (info.pct == null) return ck('warn', `소득 ${limit}% 이하${label} · 월소득을 넣어줘`);
    if (info.pct <= limit) return ck('ok', `소득 ${limit}% 이하${label} (내 소득 ${pctText(info.pct)})`);
    return ck(alt ? 'warn' : 'no', `소득 ${limit}% 초과 (내 소득 ${pctText(info.pct)})` + (alt ? ` · ${alt}` : ''));
  }

  // ctx: { regulated, capital, group, areaIdx }
  function specials(p, ref, mode, ctx) {
    const lim = R.incomeLimit[mode];
    const inc = incomeInfo(p);
    const m = joinMonths(p, ref), dep = numOrNull(p.deposit), pay = numOrNull(p.payCount);
    const r1 = rank1(p, ref, Object.assign({}, ctx, { mode }));
    const noHouse = yes(p.house !== 'now', '세대 전원 무주택');
    const alt = mode === 'private' ? '부동산 자산 기준을 맞추면 추첨 물량 가능' : null;
    const basicAccount = () => {
      const out = [m == null
        ? ck('warn', '통장 가입 6개월 이상 · 가입일을 넣어줘')
        : yes(m >= 6, `통장 가입 6개월 이상 (지금 ${ym(m)})`)];
      if (mode === 'private') {
        const need = R.deposit[ctx.group][0];
        out.push(dep == null
          ? ck('warn', `예치금 ${won(need)} 이상 · 예치금을 넣어줘`)
          : yes(dep >= need, `예치금 ${won(need)} 이상 (85㎡ 이하 기준)`));
      } else {
        out.push(pay == null
          ? ck('warn', '납입 6회 이상 · 납입 회차를 넣어줘')
          : yes(pay >= 6, `납입 6회 이상 (지금 ${pay}회)`));
      }
      return out;
    };
    const rank1Check = r1.status === 'ok' ? ck('ok', '1순위 충족')
      : r1.status === 'maybe' ? ck('warn', '1순위 요건 확인 필요') : ck('no', '1순위가 아님');
    const list = [];

    // 신혼부부
    {
      const checks = [];
      const mar = p.married ? parseD(p.marriage) : null;
      if (!p.married) checks.push(ck('no', '혼인 중이 아님'));
      else if (!mar) checks.push(ck('warn', '혼인 7년 이내 · 혼인신고일을 넣어줘'));
      else { const mm = fullMonths(mar, ref); checks.push(yes(mm < 84, `혼인 7년 이내 (지금 ${ym(Math.max(0, mm))})`)); }
      checks.push(noHouse, ...basicAccount());
      checks.push(incomeCheck(inc, p.dual ? lim.newlywedDual : lim.newlywed, p.dual ? ' · 맞벌이' : '', alt));
      list.push({ key: 'newlywed', name: '신혼부부', checks, hint: '예비신혼부부, 6세 이하 자녀를 둔 한부모가족도 신청할 수 있어.' });
    }
    // 생애최초
    {
      const checks = [yes(p.house === 'never', '세대원 모두 집을 가진 적 없음'), rank1Check];
      if (mode === 'public') {
        checks.push(dep == null
          ? ck('warn', `저축액 ${won(R.publicFirstHomeSavings)} 이상 · 예치금을 넣어줘`)
          : yes(dep >= R.publicFirstHomeSavings, `저축액 ${won(R.publicFirstHomeSavings)} 이상 (지금 ${won(dep)})`));
      }
      const fam = p.married || num(p.kidsMinor) + num(p.kidsAdult) > 0;
      checks.push(fam ? ck('ok', '혼인 중이거나 미혼 자녀 있음')
        : mode === 'private' ? ck('warn', '1인 가구는 추첨 물량(전용 60㎡ 이하)만 가능')
          : ck('no', '혼인 중이거나 미혼 자녀가 있어야 해'));
      checks.push(yes(!!p.tax5, '소득세 5년 이상 납부'));
      checks.push(incomeCheck(inc, lim.firstHome, '', alt));
      list.push({
        key: 'first', name: '생애최초', checks,
        hint: mode === 'private' ? `소득 ${lim.firstHomePriority}% 이하는 우선공급 물량에 들어가.` : '',
      });
    }
    // 신생아
    {
      const checks = [yes(!!p.newborn, '2세 미만 자녀 있음 (태아·입양 포함)'), noHouse, ...basicAccount()];
      checks.push(incomeCheck(inc, lim.newborn, '', alt));
      list.push({
        key: 'newborn', name: '신생아', checks,
        hint: mode === 'private'
          ? `2026.6.15부터 민영에도 생겼어. 혼인 기간과 상관없고, 소득 ${lim.newbornPriority}% 이하는 우선공급.`
          : '혼인 기간과 상관없이 출산 가구면 신청할 수 있어.',
      });
    }
    // 다자녀
    {
      const k = num(p.kidsMinor);
      const checks = [yes(k >= 2, `미성년 자녀 2명 이상 (지금 ${k}명)`), noHouse, ...basicAccount()];
      if (mode === 'public') checks.push(incomeCheck(inc, lim.multiChild, '', null));
      list.push({ key: 'multi', name: '다자녀', checks, hint: '태아·입양 자녀도 포함. 자녀 수·무주택기간 등으로 배점해.' });
    }
    // 노부모부양
    {
      const checks = [yes(!!p.parent65, '만 65세 이상 부모 3년 이상 부양'), yes(!!p.head, '세대주'), noHouse, rank1Check];
      if (mode === 'public') checks.push(incomeCheck(inc, lim.parents, '', null));
      list.push({ key: 'parents', name: '노부모부양', checks, hint: mode === 'private' ? '민영은 가점제로 당첨자를 뽑아.' : '' });
    }

    list.forEach(s => { s.status = statusOf(s.checks); });
    return { list, inc, r1 };
  }

  // ---------- 청약홈 API ----------
  const API_BASE = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/';
  const API_KINDS = {
    apt: { path: 'getAPTLttotPblancDetail', mdl: 'getAPTLttotPblancMdl', label: 'APT', dateFmt: 'dash' },
    remndr: { path: 'getRemndrLttotPblancDetail', mdl: 'getRemndrLttotPblancMdl', label: '무순위·잔여세대', dateFmt: 'dash' },
    urbty: { path: 'getUrbtyOfctlLttotPblancDetail', mdl: 'getUrbtyOfctlLttotPblancMdl', label: '오피스텔·도시형·민간임대', dateFmt: 'dash' },
    pblpvt: { path: 'getPblPvtRentLttotPblancDetail', mdl: 'getPblPvtRentLttotPblancMdl', label: '공공지원 민간임대', dateFmt: 'compact' },
  };

  const REGION_LONG = {
    서울특별시: '서울', 경기도: '경기', 인천광역시: '인천', 부산광역시: '부산', 대구광역시: '대구',
    광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종',
    강원도: '강원', 강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남',
    전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남',
    제주특별자치도: '제주', 제주도: '제주',
  };
  function normRegion(name, addr) {
    const s = String(name || '').trim();
    if (R.regions.includes(s)) return s;
    if (REGION_LONG[s]) return REGION_LONG[s];
    const first = String(addr || '').trim().split(/\s+/)[0] || '';
    if (REGION_LONG[first]) return REGION_LONG[first];
    const hit = R.regions.find(r => s.startsWith(r) || first.startsWith(r));
    return hit || s || '기타';
  }

  const SHORT = { sp: '특공', r1: '1순위', r1e: '1순위 기타', r2: '2순위', g: '일반', rc: '접수', an: '발표', ct: '계약' };

  function normalize(kind, r) {
    const ev = [];
    const add = (type, key, label, s, e) => {
      const sd = parseD(s);
      if (!sd) return;
      const ed = parseD(e);
      ev.push({ type, key, label, short: SHORT[key], start: sd, end: ed && ed >= sd ? ed : sd });
    };
    if (kind === 'apt') {
      add('r', 'sp', '특별공급', r.SPSPLY_RCEPT_BGNDE, r.SPSPLY_RCEPT_ENDDE);
      add('r', 'r1', '1순위 해당지역', r.GNRL_RNK1_CRSPAREA_RCPTDE, r.GNRL_RNK1_CRSPAREA_ENDDE);
      const etc = r.GNRL_RNK1_ETC_AREA_RCPTDE || r.GNRL_RNK1_ETC_GG_RCPTDE;
      if (etc && etc !== r.GNRL_RNK1_CRSPAREA_RCPTDE) {
        add('r', 'r1e', '1순위 기타지역', etc, r.GNRL_RNK1_ETC_AREA_ENDDE || r.GNRL_RNK1_ETC_GG_ENDDE);
      }
      add('r', 'r2', '2순위', r.GNRL_RNK2_CRSPAREA_RCPTDE, r.GNRL_RNK2_CRSPAREA_ENDDE);
    } else if (kind === 'remndr') {
      add('r', 'sp', '특별공급', r.SPSPLY_RCEPT_BGNDE, r.SPSPLY_RCEPT_ENDDE);
      add('r', 'g', '일반공급', r.GNRL_RCEPT_BGNDE, r.GNRL_RCEPT_ENDDE);
      if (!ev.length) add('r', 'rc', '청약 접수', r.SUBSCRPT_RCEPT_BGNDE, r.SUBSCRPT_RCEPT_ENDDE);
    } else {
      add('r', 'rc', '청약 접수', r.SUBSCRPT_RCEPT_BGNDE, r.SUBSCRPT_RCEPT_ENDDE);
    }
    add('a', 'an', '당첨자 발표', r.PRZWNER_PRESNATN_DE);
    add('c', 'ct', '계약', r.CNTRCT_CNCLS_BGNDE, r.CNTRCT_CNCLS_ENDDE);
    ev.sort((a, b) => a.start - b.start);

    let typeLabel = API_KINDS[kind].label;
    if (kind === 'apt') {
      typeLabel = r.HOUSE_DTL_SECD_NM || (r.HOUSE_DTL_SECD === '03' ? '국민' : '민영');
      if (r.HOUSE_SECD && r.HOUSE_SECD !== '01' && r.HOUSE_SECD_NM) typeLabel += ` · ${r.HOUSE_SECD_NM}`;
    } else if (kind === 'urbty') {
      typeLabel = r.HOUSE_DTL_SECD_NM || typeLabel;
    } else if (kind === 'remndr') {
      typeLabel = r.HOUSE_SECD_NM || typeLabel;
    }

    return {
      id: `${kind}-${r.HOUSE_MANAGE_NO}-${r.PBLANC_NO}`,
      kind, houseNo: r.HOUSE_MANAGE_NO, pblancNo: r.PBLANC_NO,
      name: r.HOUSE_NM || '(이름 없는 공고)',
      region: normRegion(r.SUBSCRPT_AREA_CODE_NM, r.HSSPLY_ADRES),
      address: r.HSSPLY_ADRES || '',
      total: num(r.TOT_SUPLY_HSHLDCO) || null,
      notice: parseD(r.RCRIT_PBLANC_DE),
      typeLabel,
      isPublic: kind === 'apt' && r.HOUSE_DTL_SECD === '03',
      checksRank: kind === 'apt',
      flags: {
        spec: r.SPECLT_RDN_EARTH_AT === 'Y',
        adj: r.MDAT_TRGET_AREA_SECD === 'Y',
        cap: r.PARCPRC_ULS_AT === 'Y',
      },
      events: ev,
      moveIn: r.MVN_PREARNGE_YM ? String(r.MVN_PREARNGE_YM).replace(/^(\d{4})-?(\d{2}).*/, '$1.$2') : '',
      url: r.PBLANC_URL || '', homepage: r.HMPG_ADRES || '', phone: r.MDHS_TELNO || '',
      builder: r.CNSTRCT_ENTRPS_NM || r.BSNS_MBY_NM || '',
      sample: !!r._sample,
    };
  }

  function normalizeAll(raw) {
    const out = [], seen = new Set();
    Object.keys(raw || {}).forEach(kind => {
      if (!API_KINDS[kind]) return;
      (raw[kind] || []).forEach(r => {
        const n = normalize(kind, r);
        if (!seen.has(n.id)) { seen.add(n.id); out.push(n); }
      });
    });
    return out;
  }

  const toNum = v => (v == null || v === '' ? 0 : +String(v).replace(/[^\d.]/g, '') || 0);
  function normModel(r) {
    const tyRaw = r.HOUSE_TY ? String(r.HOUSE_TY).trim() : `${r.GP || ''}${r.TP || ''}`.trim();
    const area = r.EXCLUSE_AR ? toNum(r.EXCLUSE_AR) : parseFloat(tyRaw) || 0;
    const letter = r.HOUSE_TY ? (String(r.HOUSE_TY).match(/[A-Za-z가-힣]+$/) || [''])[0] : '';
    const label = r.HOUSE_TY ? `${Math.floor(area)}${letter}` : tyRaw || `${Math.floor(area)}`;
    return {
      label, area,
      supplyArea: toNum(r.SUPLY_AR),
      general: toNum(r.SUPLY_HSHLDCO), special: toNum(r.SPSPLY_HSHLDCO),
      sp: {
        신혼부부: toNum(r.NWWDS_HSHLDCO), 생애최초: toNum(r.LFE_FRST_HSHLDCO), 신생아: toNum(r.NWBB_HSHLDCO),
        다자녀: toNum(r.MNYCH_HSHLDCO), 노부모: toNum(r.OLD_PARNTS_SUPORT_HSHLDCO), 청년: toNum(r.YGMN_HSHLDCO),
        기관추천: toNum(r.INSTT_RECOMEND_HSHLDCO), 이전기관: toNum(r.TRANSR_INSTT_ENFSN_HSHLDCO), 기타: toNum(r.ETC_HSHLDCO),
      },
      price: toNum(r.LTTOT_TOP_AMOUNT || r.SUPLY_AMOUNT),
    };
  }

  // ---------- 공고 상태 ----------
  function noticeStatus(n, t) {
    const rs = n.events.filter(e => e.type === 'r');
    const cur = rs.find(e => e.start <= t && t <= e.end);
    if (cur) {
      const left = daysBetween(t, cur.end);
      return { key: 'open', label: `${cur.label} 접수 중`, badge: left === 0 ? '오늘 마감' : `마감 D-${left}`, sort: 0, date: cur.end, cur: cur.key };
    }
    const nx = rs.find(e => e.start > t);
    if (nx) return { key: 'soon', label: `${nx.label} 접수 예정`, badge: `D-${daysBetween(t, nx.start)}`, sort: 1, date: nx.start, cur: nx.key };
    const an = n.events.find(e => e.key === 'an');
    if (an && t <= an.start) {
      const dd = daysBetween(t, an.start);
      return { key: 'wait', label: '당첨자 발표 대기', badge: dd === 0 ? '오늘 발표' : `D-${dd}`, sort: 2, date: an.start, cur: 'an' };
    }
    const ct = n.events.find(e => e.key === 'ct');
    if (ct && t <= ct.end) {
      const before = t < ct.start;
      return { key: 'contract', label: before ? '계약 예정' : '계약 진행 중', badge: before ? `D-${daysBetween(t, ct.start)}` : '', sort: 3, date: ct.start, cur: 'ct' };
    }
    if (!n.events.length) return { key: 'unknown', label: '일정 확인 필요', badge: '', sort: 4, date: n.notice || t };
    return { key: 'done', label: '종료', badge: '', sort: 5, date: n.notice || t };
  }

  function sortNotices(items) {
    return items.sort((a, b) => a.st.sort - b.st.sort
      || (a.st.key === 'done' ? b.st.date - a.st.date : a.st.date - b.st.date));
  }

  function agenda(items, t, days) {
    const end = addDays(t, days), out = [];
    items.forEach(n => n.events.forEach(e => {
      if (e.start >= t && e.start <= end) out.push({ date: e.start, n, e, ongoing: false });
      else if (e.type === 'r' && e.start < t && e.end >= t) out.push({ date: t, n, e, ongoing: true });
    }));
    out.sort((a, b) => a.date - b.date || a.e.start - b.e.start);
    return out;
  }

  const Logic = {
    parseD, today, iso, addDays, addMonths, addYears, fullMonths, daysBetween,
    fmtShort, fmtDay, fmtFull, weekday, ym, num, numOrNull, won, price, pctText,
    EMPTY_PROFILE, EXAMPLE_PROFILE,
    calcScore, familyCount, householdSize, incomeInfo,
    regionInfo, areaIndex, needMonths, rank1, specials,
    API_BASE, API_KINDS, normRegion, normalize, normalizeAll, normModel,
    noticeStatus, sortNotices, agenda,
  };
  if (typeof module === 'object' && module.exports) module.exports = Logic;
  else root.Logic = Logic;
})(typeof self !== 'undefined' ? self : this);
