/**
 * SM-2 spaced-repetition scheduler (SuperMemo-2), the same algorithm behind
 * Anki/SuperMemo. This is the "rule system" that decides how long to wait
 * before reminding the user to revise a topic again, based on how well
 * they recalled it this time.
 *
 * quality is 0-5:
 *   0-2 = poor / failed recall  -> forgotten, restart the schedule
 *   3   = correct but effortful -> keep progressing, but only just
 *   4-5 = correct and confident -> progress normally / accelerate
 *
 * On every call the ease factor is nudged up or down (never below 1.3, a
 * SuperMemo-defined floor) and the interval either resets to 1 day (poor
 * recall), or grows: 1 day -> 6 days -> previousInterval * easeFactor.
 */

export interface Sm2State {
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
}

export interface Sm2Result extends Sm2State {
  nextRevisionAt: Date;
}

const MIN_EASE_FACTOR = 1.3;
const LAPSE_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 6;

export function computeNextSchedule(
  current: Sm2State,
  quality: number,
  now: Date = new Date(),
): Sm2Result {
  if (quality < 0 || quality > 5 || !Number.isFinite(quality)) {
    throw new RangeError('quality must be a number between 0 and 5');
  }

  let { repetitions, easeFactor } = current;
  let intervalDays: number;

  if (quality < 3) {
    // Failed / poor recall: the topic is treated as forgotten. Reset the
    // repetition streak so the next few reviews rebuild confidence, but
    // keep the (slightly lowered) ease factor rather than resetting it —
    // a topic the user has struggled with should keep coming back a bit
    // more often even after they start passing again.
    repetitions = 0;
    intervalDays = LAPSE_INTERVAL_DAYS;
  } else {
    if (repetitions === 0) {
      intervalDays = 1;
    } else if (repetitions === 1) {
      intervalDays = SECOND_INTERVAL_DAYS;
    } else {
      intervalDays = Math.round(current.intervalDays * easeFactor);
    }
    repetitions += 1;
  }

  // Standard SM-2 ease factor update.
  easeFactor =
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < MIN_EASE_FACTOR) easeFactor = MIN_EASE_FACTOR;
  easeFactor = Number(easeFactor.toFixed(2));

  // Cap runaway intervals at ~2 years so a topic never falls off the radar
  // entirely even after many perfect reviews.
  intervalDays = Math.min(intervalDays, 730);

  const nextRevisionAt = new Date(
    now.getTime() + intervalDays * 24 * 60 * 60 * 1000,
  );

  return { repetitions, easeFactor, intervalDays, nextRevisionAt };
}
