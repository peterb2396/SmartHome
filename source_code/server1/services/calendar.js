// ── School calendar / holiday logic ────────────────────────────────────────────

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function inSeason(date) {
  const mm = date.getMonth() + 1;
  const inFall   = date >= new Date(date.getFullYear(), 7, 20) && date <= new Date(date.getFullYear(), 11, 31);
  const inSpring = date >= new Date(date.getFullYear(), 0, 1)  && date <= new Date(date.getFullYear(), 5, 1);
  return inFall || inSpring;
}

function isWeekday(date) {
  const d = date.getDay();
  return d >= 1 && d <= 5;
}

function isFederalHoliday(date) {
  const y   = date.getFullYear();
  const mm  = date.getMonth();
  const dd  = date.getDate();

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate();

  const nthDow = (y, m, dow, n) => {
    const first = new Date(y, m, 1);
    const shift = (dow - first.getDay() + 7) % 7;
    return new Date(y, m, 1 + shift + 7 * (n - 1));
  };

  const lastDow = (y, m, dow) => {
    const last  = new Date(y, m + 1, 0);
    const shift = (last.getDay() - dow + 7) % 7;
    return new Date(y, m + 1, -shift);
  };

  const observed = (y, m, d) => {
    const dt = new Date(y, m, d);
    if (dt.getDay() === 6) return new Date(y, m, d - 1);
    if (dt.getDay() === 0) return new Date(y, m, d + 1);
    return dt;
  };

  const holidays = [
    observed(y, 0, 1),           // New Year's Day
    nthDow(y, 0, 1, 3),          // MLK Day
    nthDow(y, 1, 1, 3),          // Presidents' Day
    lastDow(y, 4, 1),            // Memorial Day
    observed(y, 5, 19),          // Juneteenth
    observed(y, 6, 4),           // Independence Day
    nthDow(y, 8, 1, 1),          // Labor Day
    nthDow(y, 9, 1, 2),          // Columbus Day
    observed(y, 10, 11),         // Veterans Day
    nthDow(y, 10, 4, 4),         // Thanksgiving
    observed(y, 11, 25),         // Christmas
  ];

  const thanksgiving = nthDow(y, 10, 4, 4);
  const friAfterTgiving = new Date(thanksgiving); friAfterTgiving.setDate(friAfterTgiving.getDate() + 1);
  const monAfterTgiving = new Date(thanksgiving); monAfterTgiving.setDate(monAfterTgiving.getDate() + 4);
  const tueAfterTgiving = new Date(thanksgiving); tueAfterTgiving.setDate(tueAfterTgiving.getDate() + 5);

  const easter       = easterSunday(y);
  const goodFriday   = new Date(easter); goodFriday.setDate(goodFriday.getDate() - 2);
  const easterMonday = new Date(easter); easterMonday.setDate(easterMonday.getDate() + 1);

  const inWinterBreak = (mm === 11 && dd >= 24) || (mm === 0 && dd <= 2);

  return (
    inWinterBreak ||
    [friAfterTgiving, monAfterTgiving, tueAfterTgiving, goodFriday, easterMonday]
      .some(d => sameDay(d, date)) ||
    holidays.some(d => sameDay(d, date))
  );
}

function shouldRunToday(date) {
  return inSeason(date) && isWeekday(date) && !isFederalHoliday(date);
}

module.exports = { easterSunday, inSeason, isWeekday, isFederalHoliday, shouldRunToday };
