//! Local wall-clock time, from the system's `date`: it knows this machine's time zone and its daylight-saving
//! rules, so 5 PM stays 5 PM on a day the clocks change. No time zone crate, as recap.rs finds local midnight.

use crate::import::{civil_from_days, days_from_civil};

/// Unix ms for a local date and time: "YYYY-MM-DD HH:MM", with ":SS" or a "T" in the middle too. None when
/// it isn't a real one.
pub fn ms(local: &str) -> Option<u64> {
    ms_in(None, local)
}

/// A Unix ms as a local date and time, "YYYY-MM-DD HH:MM:SS".
pub fn local(ms: u64) -> Option<String> {
    local_in(None, ms)
}

/// When something that first happens at `at_ms`, then every `days` days, happens next after `after_ms`: on the
/// first of its days still to come, at `at_ms`'s local time of day.
pub fn next(at_ms: u64, days: u64, after_ms: u64) -> Option<u64> {
    next_in(None, at_ms, days, after_ms)
}

/// `zone`, such as "America/Los_Angeles", pins the tests' clock; None is this machine's.
fn ms_in(zone: Option<&str>, local: &str) -> Option<u64> {
    let [y, mo, d, h, mi, s] = parse(local)?;
    let text = format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}");
    #[cfg(target_os = "macos")]
    let args = ["-j", "-f", "%Y-%m-%d %H:%M:%S", &text, "+%s"];
    #[cfg(not(target_os = "macos"))]
    let args = ["-d", &text, "+%s"];
    date(zone, &args)?.parse::<u64>().ok().map(|secs| secs * 1000)
}

fn local_in(zone: Option<&str>, ms: u64) -> Option<String> {
    let secs = (ms / 1000).to_string();
    #[cfg(target_os = "macos")]
    let args = ["-j", "-f", "%s", &secs, "+%Y-%m-%d %H:%M:%S"];
    #[cfg(not(target_os = "macos"))]
    let at = format!("@{secs}");
    #[cfg(not(target_os = "macos"))]
    let args = ["-d", &at, "+%Y-%m-%d %H:%M:%S"];
    date(zone, &args).filter(|text| parse(text).is_some())
}

fn next_in(zone: Option<&str>, at_ms: u64, days: u64, after_ms: u64) -> Option<u64> {
    if after_ms < at_ms {
        return Some(at_ms);
    }
    let [y, m, d, h, mi, s] = parse(&local_in(zone, at_ms)?)?;
    let [ay, am, ad, ..] = parse(&local_in(zone, after_ms)?)?;
    let (start, every) = (days_from_civil(y, m, d), days.max(1) as i64);
    // The first of its days on or after `after_ms`'s, or the one after that once its time has passed.
    let day = start + ((days_from_civil(ay, am, ad) - start).max(0) + every - 1) / every * every;
    [day, day + every].into_iter().find_map(|day| {
        let (y, m, d) = civil_from_days(day);
        ms_in(zone, &format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}")).filter(|slot| *slot > after_ms)
    })
}

/// The numbers in "YYYY-MM-DD HH:MM[:SS]" (or with a "T" in the middle), when they make a real date and time.
fn parse(text: &str) -> Option<[i64; 6]> {
    let (date, time) = text.trim().split_once([' ', 'T'])?;
    let numbers = |text: &str, sep: char, widths: &[usize]| -> Option<Vec<i64>> {
        let parts: Vec<&str> = text.split(sep).collect();
        let fits = parts.len() == widths.len() && parts.iter().zip(widths).all(|(p, w)| p.len() == *w && p.bytes().all(|b| b.is_ascii_digit()));
        fits.then(|| parts.iter().map(|p| p.parse().unwrap_or(0)).collect())
    };
    let date = numbers(date, '-', &[4, 2, 2])?;
    let time = numbers(time, ':', &[2, 2]).or_else(|| numbers(time, ':', &[2, 2, 2]))?;
    let [y, m, d] = date[..] else { return None };
    let (h, mi, s) = (time[0], time[1], time.get(2).copied().unwrap_or(0));
    // A day the month has ("2026-02-30" isn't one), and a time the clock shows.
    let real = civil_from_days(days_from_civil(y, m, d)) == (y, m, d) && (1..=12).contains(&m) && h < 24 && mi < 60 && s < 60;
    real.then_some([y, m, d, h, mi, s])
}

/// The system's `date` with these arguments, in `zone` or this machine's.
fn date(zone: Option<&str>, args: &[&str]) -> Option<String> {
    let mut date = std::process::Command::new("date");
    date.args(args);
    if let Some(zone) = zone {
        date.env("TZ", zone);
    }
    let out = date.output().ok().filter(|o| o.status.success())?;
    String::from_utf8(out.stdout).ok().map(|text| text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{local_in, ms_in, next_in};

    /// US Pacific: clocks went back at 2 AM on Nov 1, 2026, and go forward at 2 AM on Mar 8, 2026.
    const LA: Option<&str> = Some("America/Los_Angeles");

    fn at(local: &str) -> u64 {
        ms_in(LA, local).unwrap()
    }

    #[test]
    fn five_pm_is_five_pm_on_the_days_the_clocks_change_and_on_an_ordinary_one() {
        for (local, utc) in [
            // 17:00 PST is 01:00 UTC the next day; local midnight + 17 h was 16:00, the bug.
            ("2026-11-01 17:00", 1_793_581_200_000),
            // 17:00 PDT is 00:00 UTC the next day; midnight + 17 h would be 18:00.
            ("2026-03-08 17:00", 1_773_014_400_000),
            ("2026-11-03 17:00", 1_793_754_000_000),
            ("2026-07-15T17:00:00", 1_784_160_000_000),
        ] {
            assert_eq!(ms_in(LA, local), Some(utc), "{local}");
            assert_eq!(local_in(LA, utc), Some(format!("{} 17:00:00", &local[..10])), "{local}");
        }
        // Not a real date and time: None, never a guess.
        for text in ["5 PM", "17:00", "2026-11-01", "2026-02-30 17:00", "2026-11-01 24:00", "2026-11-01 5:00", "2026-11-01 17:00 PST", ""] {
            assert_eq!(ms_in(LA, text), None, "{text}");
        }
    }

    #[test]
    fn a_daily_time_keeps_its_hour_across_the_change() {
        // Set for 5 PM on Oct 31, every day: Nov 1's is 25 hours later, not 24 (that was 4 PM).
        let first = at("2026-10-31 17:00");
        assert_eq!(next_in(LA, first, 1, first), Some(at("2026-11-01 17:00")));
        assert_eq!(at("2026-11-01 17:00") - first, 25 * 3_600_000);
        // Spring forward: 23 hours.
        let march = at("2026-03-07 17:00");
        assert_eq!(next_in(LA, march, 1, march), Some(at("2026-03-08 17:00")));
        assert_eq!(at("2026-03-08 17:00") - march, 23 * 3_600_000);
        // Not started yet; a run that came late (the laptop slept through 5 PM) keeps the hour; every week.
        assert_eq!(next_in(LA, first, 1, first - 1), Some(first));
        assert_eq!(next_in(LA, first, 1, at("2026-11-02 21:30")), Some(at("2026-11-03 17:00")));
        assert_eq!(next_in(LA, first, 7, at("2026-11-01 17:00")), Some(at("2026-11-07 17:00")));
        assert_eq!(next_in(LA, first, 7, at("2026-11-07 16:59")), Some(at("2026-11-07 17:00")));
    }
}
