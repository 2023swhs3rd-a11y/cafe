/**
 * 봉일천고 진로카페 예약 시스템 - Google Apps Script 서버 코드
 *
 * 구조: 이 스크립트는 "진로카페 예약" 구글 시트에 붙어서(확장 프로그램 > Apps Script) 동작합니다.
 *  - 날짜별 탭(예: 261123(MON))을 그대로 읽고, 예약하면 해당 슬롯의 빈 칸(C/D 또는 E/F)에 이름과 메뉴를 적습니다.
 *  - 기존 탭의 서식/수식(B열 "가능", 하단 합계 등)은 건드리지 않습니다.
 */

var CONFIG = {
  TIMEZONE: 'Asia/Seoul',
  // 메뉴 목록 (시트의 드롭다운과 같은 표기)
  MENUS: ['(HOT)아메리카노', '(ICED)아메리카노', '(ICED)라떼', '(ICED)오트라떼'],
  // 예약 마감: 당일 이 시각(HH:mm) 이후에는 그 날짜 예약/취소 불가. 빈 문자열이면 제한 없음.
  SAME_DAY_CUTOFF: '08:00',
  // 한 사람이 하루에 예약할 수 있는 잔 수
  MAX_PER_PERSON_PER_DAY: 1,
  // 예약 불가 명단(노쇼 3회 등)을 적는 탭 이름. A열에 이름을 적으면 예약이 막힙니다. 탭이 없으면 무시.
  BLOCK_SHEET: '예약불가',
  APP_TITLE: '봉일천고 진로카페 ☕',
  // 처음·오랜만 손님 권장 (예약 화면 안내 + 새 오픈일 우선 예약)
  GUIDE: {
    RECENT_DAYS: 4,      // '최근'으로 보는 지난 오픈일 수
    REGULAR_MIN: 3,      // 최근 오픈일 중 이만큼 이상 오셨으면 '자주 오시는 분' → 양보 권유(막지는 않음)
    PRIORITY_MAX: 1,     // 최근 오픈일 중 이만큼 이하로 오셨으면 우선 예약 가능
    BACK_WEEKS: 4,       // 마지막 방문이 이만큼(주) 넘었으면 '오랜만'
    PRIORITY_HOURS: 24   // 새 오픈일을 만든 뒤 이 시간 동안은 우선 예약 대상만 예약 가능. 0이면 끔
  },
  // 카페 규칙: 앱의 '카페 규칙' 화면에 한 줄씩 보여 줍니다. 바꾸려면 이 목록만 고치세요.
  RULES: [
    '10분에 두 분씩만 받습니다',
    '아이스라떼(멸균우유) 또는 아이스오트라떼 가능',
    '예약 시간을 지나서 오시면 응대가 어렵습니다',
    '빠른 서빙을 위해 커스텀과 스팀은 불가능(우유양은 180ml 고정, 에스프레소샷 19-20g에 33-36ml 추출(기본 더블샷))',
    '깨끗한 텀블러 지참해주세요',
    '드시고 가셔도 됩니다: 다만 앞교실이 수업 중인 경우에는 조용히 대화해주세요',
    '원두: 에스프레소 블렌드 원두(에티오피아, 브라질, 과테말라 등)',
    '해당시간대에 이름을 작성하시고 메뉴를 목록에서 골라주세요',
    '대리수령, 대리입력보다는 직접 와주시고 직접 입력해주시기 바랍니다'
  ]
};

var TAB_RE = /^(\d{2})(\d{2})(\d{2})\s*\(([A-Za-z]{3})\)\s*$/;
var TIME_RE = /^\s*(\d{1,2}):(\d{2})\s*$/;

/* ---------------- 웹앱 진입점 ---------------- */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---------------- 카페 입구 암호 ----------------
 * 4자리 암호는 Apps Script > 프로젝트 설정 > 스크립트 속성에 CAFE_CODE 로 저장하세요(예: 0824).
 * 속성이 없으면 문이 잠기지 않습니다. 웹앱에서 부르는 함수는 모두 cafe() 를 거쳐 암호를 확인합니다.
 */
function cafeCode_() {
  var v = PropertiesService.getScriptProperties().getProperty('CAFE_CODE');
  return v ? String(v).trim() : '';
}
function checkCode_(code) {
  var real = cafeCode_();
  if (!real) return;
  if (String(code || '').trim() !== real) { Utilities.sleep(600); throw new Error('CAFE_CODE: 암호가 맞지 않아요.'); }
}
/** 입구 도어락: 암호가 맞는지만 알려 줍니다. */
function enter(code) {
  var real = cafeCode_();
  if (!real) return { ok: true, locked: false };
  if (String(code || '').trim() === real) return { ok: true, locked: true };
  Utilities.sleep(600); // 마구 눌러 보기 방지
  return { ok: false, locked: true };
}
/**
 * GitHub Pages 화면용 창구: POST 본문 {"fn": "enter" | "cafe", "args": [...]} 를 받아 JSON으로 돌려줍니다.
 * (Apps Script 배포 > 액세스 권한을 "모든 사용자"로 해야 GitHub Pages에서 부를 수 있어요.)
 */
function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var args = Array.isArray(req.args) ? req.args : [];
    var data;
    if (req.fn === 'enter') data = enter(args[0]);
    else if (req.fn === 'cafe') data = cafe(args[0], args[1], args[2]);
    else throw new Error('알 수 없는 요청이에요.');
    out = { ok: true, data: data };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 웹앱 → 서버 호출 창구 (암호 확인 후 실행) */
var PUBLIC_ = {
  getInitData: function () { return getInitData_(); },
  getDay: function (a) { return getDay_(a); },
  reserve: function (a, b, c, d) { return reserve_(a, b, c, d); },
  cancel: function (a, b, c) { return cancel_(a, b, c); },
  getMyHistory: function (a) { return getMyHistory_(a); },
  getMyCard: function (a) { return getMyCard_(a); },
  guide: function (a, b) { return guide_(a, b); },
  adminLogin: function (a) { return adminLogin_(a); },
  adminCreateDay: function (a, b, c, d) { return adminCreateDay_(a, b, c, d); },
  adminGetDay: function (a, b) { return adminGetDay_(a, b); }
};
function cafe(code, fn, args) {
  checkCode_(code);
  if (!Object.prototype.hasOwnProperty.call(PUBLIC_, fn)) throw new Error('알 수 없는 요청이에요.');
  return PUBLIC_[fn].apply(null, args || []);
}

/** 시트를 열면 상단에 관리자 메뉴가 생깁니다. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('☕ 진로카페')
    .addItem('새 카페 날짜 탭 만들기', 'menuCreateCafeDay')
    .addItem('우수 고객 보고서 탭 만들기/갱신', 'writeStatsSheet')
    .addToUi();
}

/* ---------------- 클라이언트에서 부르는 API ---------------- */

/** 첫 화면에 필요한 모든 데이터: 예약 가능한 날짜, 통계 */
function getInitData_() {
  var days = readAllDays_();
  var today = todayKey_();
  var nowHM = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm');
  var todayClosed = CONFIG.SAME_DAY_CUTOFF && nowHM >= CONFIG.SAME_DAY_CUTOFF;
  // 오늘 탭은 당일 마감 시각 전까지만 예약 가능 목록에 보여 줌
  var open = days.filter(function (d) { return d.key > today || (d.key === today && !todayClosed); })
    .sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  return {
    menus: CONFIG.MENUS,
    today: today,
    openDays: open.map(publicDay_),
    stats: computeStats_(days),
    rules: readRules_(days)
  };
}

/** 특정 날짜의 최신 슬롯 현황(새로고침용) */
function getDay_(tabName) {
  var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sh) throw new Error('해당 날짜 탭을 찾을 수 없어요.');
  return publicDay_(parseSheet_(sh));
}

/** 예약하기 */
function reserve_(tabName, time, name, menu) {
  name = cleanName_(name);
  if (!name) throw new Error('성함을 입력해 주세요.');
  if (name.length > 10) throw new Error('성함은 10자 이내로 적어 주세요.');
  if (CONFIG.MENUS.indexOf(menu) < 0) throw new Error('메뉴를 목록에서 골라 주세요.');
  if (isBlocked_(name)) throw new Error('지금은 예약이 어려워요. 바리스타 선생님께 문의해 주세요.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
    if (!sh) throw new Error('해당 날짜 탭을 찾을 수 없어요.');
    var day = parseSheet_(sh);
    checkCutoff_(day);
    if (!day.hasMenu) throw new Error('이 날짜는 메뉴 선택 양식이 아니라서 시트에서 직접 신청해 주세요.');
    var until = priorityUntil_(tabName);
    if (until && !profile_(name, readAllDays_()).eligible) {
      throw new Error('지금은 처음·오랜만에 오시는 분 먼저 예약하는 시간이에요. ' +
        Utilities.formatDate(new Date(until), CONFIG.TIMEZONE, 'M/d HH:mm') + '부터 예약할 수 있어요.');
    }

    var mine = 0;
    day.slots.forEach(function (s) {
      s.seats.forEach(function (seat) { if (normName_(seat.name) === normName_(name)) mine++; });
    });
    if (mine >= CONFIG.MAX_PER_PERSON_PER_DAY) throw new Error('이미 이 날짜에 예약하셨어요! 하루 ' + CONFIG.MAX_PER_PERSON_PER_DAY + '잔까지예요.');

    var slot = day.slots.filter(function (s) { return s.time === time; })[0];
    if (!slot) throw new Error('해당 시간대를 찾을 수 없어요.');
    var seatIdx = -1;
    for (var i = 0; i < slot.seats.length; i++) { if (!slot.seats[i].name) { seatIdx = i; break; } }
    if (seatIdx < 0) throw new Error('아쉽게도 방금 마감됐어요 ㅠㅠ 다른 시간을 골라 주세요.');

    var col = day.seatCols[seatIdx];
    sh.getRange(slot.row, col.name, 1, 2).setValues([[name, menu]]);
    SpreadsheetApp.flush();
    return { ok: true, day: publicDay_(parseSheet_(sh)), visits: visitCount_(name) };
  } finally {
    lock.releaseLock();
  }
}

/** 예약 취소 (본인 이름이 적힌 칸만) */
function cancel_(tabName, time, name) {
  name = cleanName_(name);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
    if (!sh) throw new Error('해당 날짜 탭을 찾을 수 없어요.');
    var day = parseSheet_(sh);
    checkCutoff_(day);
    var slot = day.slots.filter(function (s) { return s.time === time; })[0];
    if (!slot) throw new Error('해당 시간대를 찾을 수 없어요.');
    for (var i = 0; i < slot.seats.length; i++) {
      if (normName_(slot.seats[i].name) === normName_(name)) {
        var col = day.seatCols[i];
        sh.getRange(slot.row, col.name, 1, day.hasMenu ? 2 : 1).clearContent();
        SpreadsheetApp.flush();
        return { ok: true, day: publicDay_(parseSheet_(sh)) };
      }
    }
    throw new Error('그 시간에 해당 성함으로 된 예약이 없어요.');
  } finally {
    lock.releaseLock();
  }
}

/** 이름으로 예약 찾기 */
function findMyReservations_(name) {
  name = normName_(name);
  if (!name) return [];
  var today = todayKey_();
  var out = [];
  readAllDays_().forEach(function (d) {
    if (d.key < today) return;
    d.slots.forEach(function (s) {
      s.seats.forEach(function (seat) {
        if (normName_(seat.name) === name) out.push({ tab: d.tab, label: d.label, key: d.key, time: s.time, menu: seat.menu });
      });
    });
  });
  return out.sort(function (a, b) { return a.key < b.key ? -1 : 1; });
}

/**
 * 내 예약 + 지난 이용 기록 전체
 * upcoming: 아직 지나지 않은 예약(취소 가능), past: 지난 이용일과 고른 메뉴(최근 순)
 */
function getMyHistory_(name) {
  var n = normName_(name);
  if (!n) return { upcoming: [], past: [] };
  var today = todayKey_();
  var nowHM = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm');
  var todayClosed = CONFIG.SAME_DAY_CUTOFF && nowHM >= CONFIG.SAME_DAY_CUTOFF;
  var up = [], past = [];
  readAllDays_().forEach(function (d) {
    d.slots.forEach(function (s) {
      s.seats.forEach(function (seat) {
        if (normName_(seat.name) !== n) return;
        var r = { tab: d.tab, label: d.label, key: d.key, time: s.time, menu: seat.menu || (d.hasMenu ? '' : '아메리카노·롱블랙') };
        if (d.key > today || (d.key === today && !todayClosed)) up.push(r); else past.push(r);
      });
    });
  });
  up.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : (a.time < b.time ? -1 : 1); });
  past.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  return { upcoming: up, past: past };
}

/** 나의 단골 카드: 이름으로 내 순위·별명·통계 조회 */
function getMyCard_(name) {
  var n = normName_(name);
  if (!n) return null;
  var saved = maskName_;
  maskName_ = function (x) { return normName_(x); };
  try {
    var st = computeStats_(readAllDays_());
    var me = st.ranking.filter(function (p) { return p.name === n; })[0];
    if (!me) return null;
    me.totalPeople = st.totalPeople;
    me.totalDays = st.totalDays;
    return me;
  } finally { maskName_ = saved; }
}

/* ---------------- 처음·오랜만 손님 권장 ---------------- */

/** 이름으로 손님 유형 판단: new(처음) / back(오랜만) / regular(자주) / normal */
function profile_(name, days) {
  var n = normName_(name), G = CONFIG.GUIDE, today = todayKey_();
  var past = days.filter(function (d) { return d.key < today; })
    .sort(function (a, b) { return a.key < b.key ? 1 : -1; });
  var visits = 0, lastKey = '', recent = 0;
  past.forEach(function (d, i) {
    var came = d.slots.some(function (s) { return s.seats.some(function (x) { return normName_(x.name) === n; }); });
    if (!came) return;
    visits++;
    if (!lastKey) lastKey = d.key;
    if (i < G.RECENT_DAYS) recent++;
  });
  var weeks = lastKey ? Math.floor((Date.parse(today) - Date.parse(lastKey)) / (7 * 86400000)) : 0;
  var kind = !visits ? 'new' : weeks >= G.BACK_WEEKS ? 'back' : recent >= G.REGULAR_MIN ? 'regular' : 'normal';
  return {
    kind: kind, visits: visits, recent: recent, recentDays: Math.min(G.RECENT_DAYS, past.length), weeks: weeks,
    eligible: kind === 'new' || kind === 'back' || recent <= G.PRIORITY_MAX
  };
}

/** 새 오픈일 우선 예약이 끝나는 시각(ms). 우선 예약 중이 아니면 0 */
function priorityUntil_(tab) {
  var h = CONFIG.GUIDE.PRIORITY_HOURS;
  if (!h) return 0;
  var at = Number(PropertiesService.getScriptProperties().getProperty('OPEN_AT_' + tab) || 0);
  if (!at) return 0;
  var until = at + h * 3600000;
  return until > Date.now() ? until : 0;
}

/** 예약 화면: 이름을 넣으면 손님 유형과 이 날짜 예약 가능 여부를 알려 줌 */
function guide_(name, tab) {
  if (!normName_(name)) return null;
  var p = profile_(name, readAllDays_());
  p.priorityUntil = tab ? priorityUntil_(tab) : 0;
  p.canReserve = !p.priorityUntil || p.eligible;
  return p;
}

/* ---------------- 시트 파싱 ---------------- */

function readAllDays_() {
  var days = [];
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    if (!TAB_RE.test(sh.getName())) return;
    try { days.push(parseSheet_(sh)); } catch (e) { /* 양식이 다른 탭은 건너뜀 */ }
  });
  return days;
}

/**
 * 탭 하나를 읽어서 {tab, key, label, hasMenu, seatCols, slots[]} 로 바꿉니다.
 * 신형(메뉴 있음): A시간 B가능 C이름1 D메뉴1 E이름2 F메뉴2
 * 구형(260423):   A시간 B가능 C이름1 D이름2
 */
function parseSheet_(sh) {
  var m = sh.getName().match(TAB_RE);
  var key = '20' + m[1] + '-' + m[2] + '-' + m[3];
  var lastRow = Math.min(sh.getLastRow(), 60);
  var vals = sh.getRange(1, 1, lastRow, 6).getDisplayValues();
  var header = vals[0];
  var hasMenu = String(header[3]).indexOf('메뉴') >= 0;
  var seatCols = hasMenu ? [{ name: 3, menu: 4 }, { name: 5, menu: 6 }] : [{ name: 3 }, { name: 4 }];

  var slots = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    if (!TIME_RE.test(row[0])) continue;
    var seats = seatCols.map(function (c) {
      return { name: String(row[c.name - 1] || '').trim(), menu: c.menu ? String(row[c.menu - 1] || '').trim() : '' };
    });
    slots.push({ row: r + 1, time: row[0].trim(), seats: seats });
  }
  var dows = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금', SAT: '토', SUN: '일' };
  return {
    tab: sh.getName(), key: key, hasMenu: hasMenu, seatCols: seatCols, slots: slots,
    label: Number(m[2]) + '/' + Number(m[3]) + ' (' + (dows[m[4].toUpperCase()] || m[4]) + ')'
  };
}

/** 클라이언트로 보낼 때: 시트처럼 예약자 이름을 그대로 보여 줌(예약 화면에서 서로 확인) */
function publicDay_(d) {
  return {
    tab: d.tab, key: d.key, label: d.label, hasMenu: d.hasMenu, priorityUntil: priorityUntil_(d.tab),
    slots: d.slots.map(function (s) {
      return {
        time: s.time,
        seats: s.seats.map(function (seat) {
          return seat.name ? { taken: true, who: normName_(seat.name), menu: seat.menu } : { taken: false };
        })
      };
    })
  };
}

function readRules_(days) {
  // CONFIG.RULES가 있으면 그것을, 없으면 가장 최근 탭의 I2 셀(안내문)을 보여줍니다.
  if (CONFIG.RULES && CONFIG.RULES.length) return CONFIG.RULES.slice();
  var latest = days.slice().sort(function (a, b) { return a.key < b.key ? 1 : -1; })[0];
  if (!latest) return '';
  var sh = SpreadsheetApp.getActive().getSheetByName(latest.tab);
  return String(sh.getRange('I2').getDisplayValue() || '');
}

/* ---------------- 통계 & 우수 고객 ---------------- */

function computeStats_(days) {
  var today = todayKey_();
  var past = days.filter(function (d) { return d.key <= today; })
    .sort(function (a, b) { return a.key < b.key ? -1 : 1; });
  var people = {};
  var menuTotals = {};
  var perDay = [];

  past.forEach(function (d, dayIdx) {
    var cups = 0;
    d.slots.forEach(function (s) {
      var early = timeMinutes_(s.time) <= 8 * 60 + 40;
      var late = timeMinutes_(s.time) >= 10 * 60 && timeMinutes_(s.time) < 9999;
      s.seats.forEach(function (seat) {
        var n = normName_(seat.name);
        if (!n) return;
        cups++;
        var p = people[n] || (people[n] = { name: n, visits: 0, menus: {}, days: [], early: 0, late: 0, first: dayIdx, last: '' });
        p.visits++;
        p.days.push(dayIdx);
        p.last = d.key;
        if (early) p.early++;
        if (late) p.late++;
        var menu = seat.menu || '(HOT)아메리카노'; // 구형 탭은 아메리카노/롱블랙만 있었음
        p.menus[menu] = (p.menus[menu] || 0) + 1;
        menuTotals[menu] = (menuTotals[menu] || 0) + 1;
      });
    });
    perDay.push({ label: d.label, key: d.key, cups: cups });
  });

  var total = past.length;
  var list = Object.keys(people).map(function (k) {
    var p = people[k];
    // 최근 연속 출석(가장 최근 카페 날부터 거꾸로)
    var streak = 0;
    for (var i = total - 1; i >= 0; i--) { if (p.days.indexOf(i) >= 0) streak++; else break; }
    // 최장 연속 출석
    var best = 0, run = 0;
    for (var j = 0; j < total; j++) { if (p.days.indexOf(j) >= 0) { run++; best = Math.max(best, run); } else run = 0; }
    var fav = Object.keys(p.menus).sort(function (a, b) { return p.menus[b] - p.menus[a]; })[0];
    return {
      name: p.name, visits: p.visits, rate: total ? Math.round(p.visits / total * 100) : 0,
      streak: streak, bestStreak: best, early: p.early, late: p.late, first: p.first, last: p.last,
      fav: fav, favCount: p.menus[fav], menus: p.menus, variety: Object.keys(p.menus).length,
      score: p.visits * 10 + streak * 3 + best * 2
    };
  });

  // 우수 고객 순위: 점수(방문×10 + 현재연속×3 + 최장연속×2) → 방문수 → 최근 방문
  list.sort(function (a, b) {
    return b.score - a.score || b.visits - a.visits || (a.last < b.last ? 1 : -1);
  });
  list.forEach(function (p, i) { p.rank = i + 1; p.nick = makeNickname_(p, total); });

  var titles = makeTitles_(list); // 특별상은 실명으로
  return {
    totalDays: total, totalCups: list.reduce(function (s, p) { return s + p.visits; }, 0),
    totalPeople: list.length, menuTotals: menuTotals, perDay: perDay,
    ranking: list.map(function (p) { p.name = maskName_(p.name, p.rank <= 10); return p; }),
    titles: titles
  };
}

/**
 * 손님마다 방문 패턴으로 별명을 붙여 줍니다. (앞: 수식어 / 뒤: 등급)
 * 예) "새벽을 여는 오트라떼 VIP", "꾸준한 뜨아 단골"
 */
function makeNickname_(p, totalDays) {
  var menuNick = {
    '(HOT)아메리카노': '뜨아', '(ICED)아메리카노': '아아', '(ICED)라떼': '라떼', '(ICED)오트라떼': '오트라떼'
  };
  var adj;
  if (p.early >= 3 && p.early >= p.visits / 2) adj = '새벽을 여는';
  else if (p.streak >= 4) adj = '불꽃 연속출석';
  else if (p.bestStreak >= 5) adj = '꾸준함의 아이콘';
  else if (p.variety >= 4) adj = '메뉴 탐험가';
  else if (p.favCount >= 5 && p.favCount === p.visits) adj = '한우물 파는';
  else if (p.visits === 1) adj = '반가운 새내기';
  else adj = '다정한';
  var grade;
  var rate = totalDays ? p.visits / totalDays : 0;
  if (p.rank === 1 && p.visits >= 3) grade = '카페의 전설';
  else if (p.rank <= 3 && p.visits >= 3) grade = 'VVIP';
  else if (rate >= 0.7) grade = 'VIP';
  else if (rate >= 0.4) grade = '단골';
  else if (p.visits >= 2) grade = '손님';
  else grade = '첫 손님';
  return adj + ' ' + (menuNick[p.fav] || '') + ' ' + grade;
}

function makeTitles_(list) {
  function top(fn) {
    var best = null;
    list.forEach(function (p) { var v = fn(p); if (v > 0 && (!best || v > best.v)) best = { p: p, v: v }; });
    return best;
  }
  var t = [];
  var add = function (icon, title, desc, hit, unit) {
    if (hit) t.push({ icon: icon, title: title, desc: desc, who: hit.p.name, value: hit.v + unit });
  };
  add('🏃', '얼리버드상', '8:30~8:40 첫 타임 단골', top(function (p) { return p.early; }), '회');
  add('🔥', '개근상', '가장 오래 연속 출석', top(function (p) { return p.bestStreak; }), '연속');
  add('🌾', '오트라떼 마니아', '고소함을 사랑하는 분', top(function (p) { return p.menus['(ICED)오트라떼'] || 0; }), '잔');
  add('🥛', '라떼 러버', '부드러움 담당', top(function (p) { return p.menus['(ICED)라떼'] || 0; }), '잔');
  add('🧊', '아아 장인', '얼음 가득 아메리카노 외길', top(function (p) { return p.menus['(ICED)아메리카노'] || 0; }), '잔');
  add('♨️', '뜨아 지킴이', '사계절 따뜻한 아메리카노', top(function (p) { return p.menus['(HOT)아메리카노'] || 0; }), '잔');
  add('🌙', '마감 요정', '10시 이후 늦은 타임 단골', top(function (p) { return p.late; }), '회');
  add('🏛️', '개국공신', '첫 오픈날부터 함께한 단골', top(function (p) { return p.first === 0 ? p.visits : 0; }), '회 방문');
  add('🌈', '탐험가상', '모든 메뉴 골고루', top(function (p) { return p.variety >= 3 ? p.variety * 100 + p.visits : 0; }), '');
  // 탐험가 값 표기 정리
  t.forEach(function (x) { if (x.title === '탐험가상') x.value = ''; });
  return t;
}

function visitCount_(name) {
  var n = normName_(name), c = 0;
  readAllDays_().forEach(function (d) {
    d.slots.forEach(function (s) { s.seats.forEach(function (seat) { if (normName_(seat.name) === n) c++; }); });
  });
  return c;
}

/* ---------------- 관리자 기능 ---------------- */

/**
 * 관리자 비밀번호는 Apps Script > 프로젝트 설정 > 스크립트 속성에 ADMIN_PASSWORD 로 저장하세요.
 * (코드에 비밀번호를 적지 않습니다)
 */
function checkAdmin_(pw) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real) throw new Error('관리자 비밀번호가 아직 설정되지 않았어요(스크립트 속성 ADMIN_PASSWORD).');
  if (String(pw) !== real) throw new Error('비밀번호가 달라요.');
}

function adminLogin_(pw) { checkAdmin_(pw); return true; }

/** 웹앱 관리자 화면: 새 오픈일 만들기 */
function adminCreateDay_(pw, yymmdd, start, end) {
  checkAdmin_(pw);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var tab = createCafeDay_(yymmdd, start, end);
    return { ok: true, tab: tab, day: publicDay_(parseSheet_(SpreadsheetApp.getActive().getSheetByName(tab))) };
  } finally { lock.releaseLock(); }
}

/** 웹앱 관리자 화면: 이름 가리지 않은 예약 현황(다음 오픈일) */
function adminGetDay_(pw, tabName) {
  checkAdmin_(pw);
  var d = parseSheet_(SpreadsheetApp.getActive().getSheetByName(tabName));
  return d.slots.map(function (s) {
    return { time: s.time, seats: s.seats.map(function (x) { return { name: x.name, menu: x.menu }; }) };
  });
}

/* ---------------- 관리자 기능 (시트 메뉴) ---------------- */

function menuCreateCafeDay() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('새 카페 날짜', '날짜를 YYMMDD 형식으로 입력하세요 (예: 261207)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var name = createCafeDay_(res.getResponseText().trim());  // 시간대는 최근 탭과 동일
  ui.alert('"' + name + '" 탭을 만들었어요! 웹앱에 바로 표시됩니다.');
}

/**
 * 가장 최근 날짜 탭을 복사해서 새 날짜 탭을 만들고, 이름/메뉴 칸(C~F)만 비웁니다.
 * 기존 탭은 수정하지 않습니다.
 */
function createCafeDay_(yymmdd, start, end) {
  if (!/^\d{6}$/.test(yymmdd)) throw new Error('YYMMDD 형식(6자리 숫자)으로 입력해 주세요.');
  var ss = SpreadsheetApp.getActive();
  var date = new Date(2000 + Number(yymmdd.slice(0, 2)), Number(yymmdd.slice(2, 4)) - 1, Number(yymmdd.slice(4, 6)));
  if (isNaN(date.getTime()) || date.getMonth() !== Number(yymmdd.slice(2, 4)) - 1) throw new Error('존재하지 않는 날짜예요.');
  var dow = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()];
  var kdow = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  var tabName = yymmdd + '(' + dow + ')';
  if (ss.getSheetByName(tabName)) throw new Error('이미 같은 날짜 탭이 있어요: ' + tabName);

  var template = readAllDays_().filter(function (d) { return d.hasMenu; })
    .sort(function (a, b) { return a.key < b.key ? 1 : -1; })[0];
  if (!template) throw new Error('복사할 기존 날짜 탭이 없어요.');

  // 원하는 시간대 목록(10분 간격). 지정 안 하면 템플릿 그대로.
  var times = null;
  if (start && end) {
    var a = timeMinutes_(start), b = timeMinutes_(end);
    if (a === 9999 || b === 9999 || b < a) throw new Error('시간은 8:30 ~ 10:50 처럼 입력해 주세요.');
    times = [];
    for (var t = a; t <= b; t += 10) times.push(Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2));
    if (times.length > 30) throw new Error('시간대가 너무 많아요(최대 30칸).');
    if (times.length < 4) throw new Error('시간대는 최소 4칸(40분) 이상이어야 해요.');
  }

  var src = ss.getSheetByName(template.tab);
  var sh = src.copyTo(ss).setName(tabName);
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
  sh.getRange('A1').setValue((date.getMonth() + 1) + '/' + date.getDate() + ' ' + kdow);

  var first = template.slots[0].row, n = template.slots.length;
  if (times) {
    if (times.length < n) {
      sh.deleteRows(first + times.length, n - times.length);
    } else if (times.length > n) {
      // 마지막 슬롯 행 '앞'에 끼워 넣어야 하단 합계 수식 범위가 함께 늘어납니다.
      var extra = times.length - n, lastRow = first + n - 1;
      sh.insertRowsBefore(lastRow, extra);
      var model = sh.getRange(first, 1, 1, sh.getMaxColumns());
      for (var i = 0; i < extra; i++) model.copyTo(sh.getRange(lastRow + i, 1, 1, sh.getMaxColumns()));
    }
    n = times.length;
    sh.getRange(first, 1, n, 1).setNumberFormat('@').setValues(times.map(function (x) { return [x]; }));
  }
  sh.getRange(first, 3, n, 4).clearContent();
  // 우선 예약 시작 시각 기록 (CONFIG.GUIDE.PRIORITY_HOURS 동안 처음·오랜만 손님 먼저)
  PropertiesService.getScriptProperties().setProperty('OPEN_AT_' + tabName, String(Date.now()));
  return tabName;
}

/** "우수고객" 탭에 순위표를 써 줍니다(없으면 새로 만듦). 기존 날짜 탭은 건드리지 않음. */
function writeStatsSheet() {
  var ss = SpreadsheetApp.getActive();
  var stats = computeStatsRaw_();
  var sh = ss.getSheetByName('우수고객') || ss.insertSheet('우수고객');
  sh.clear();
  var rows = [['순위', '성함', '방문', '출석률(%)', '현재 연속', '최장 연속', '최애 메뉴', '점수']];
  stats.forEach(function (p) {
    rows.push([p.rank, p.name, p.visits, p.rate, p.streak, p.bestStreak, p.fav + ' (' + p.favCount + ')', p.score]);
  });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold').setBackground('#f3e2c7');
  sh.setFrozenRows(1);
}

/** 관리자용: 이름을 가리지 않은 순위 */
function computeStatsRaw_() {
  var saved = maskName_;
  maskName_ = function (n) { return n; };
  try { return computeStats_(readAllDays_()).ranking; } finally { maskName_ = saved; }
}

/* ---------------- 유틸 ---------------- */

function cleanName_(n) { return String(n || '').replace(/[\r\n\t]/g, '').trim(); }
/** 비교용 이름: 괄호 표기(예: 이은지(특))와 공백 제거 */
function normName_(n) { return String(n || '').replace(/\(.*?\)/g, '').replace(/\s+/g, '').trim(); }

/** 개인정보 보호용 이름 가림: 김대현 → 김*현. full=true 이면 그대로(순위 상위권 표시용) */
function maskName_(n, full) {
  n = normName_(n);
  if (full) return n;
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0] + '*';
  return n[0] + new Array(n.length - 1).join('*') + n[n.length - 1];
}

function timeMinutes_(t) { var m = String(t).match(TIME_RE); return m ? Number(m[1]) * 60 + Number(m[2]) : 9999; }
function todayKey_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }

function checkCutoff_(day) {
  var today = todayKey_();
  if (day.key < today) throw new Error('지난 날짜는 변경할 수 없어요.');
  if (day.key === today && CONFIG.SAME_DAY_CUTOFF) {
    var now = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm');
    if (now >= CONFIG.SAME_DAY_CUTOFF) throw new Error('오늘 예약/취소는 ' + CONFIG.SAME_DAY_CUTOFF + '에 마감됐어요.');
  }
}

function isBlocked_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.BLOCK_SHEET);
  if (!sh || sh.getLastRow() < 1) return false;
  var n = normName_(name);
  return sh.getRange(1, 1, sh.getLastRow(), 1).getDisplayValues()
    .some(function (r) { return normName_(r[0]) === n; });
}
