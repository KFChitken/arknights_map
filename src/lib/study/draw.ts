/**
 * The day's course of 325大学习, drawn for each player on their own (the server for a signed-in player,
 * src/lib/server/study.ts; a visitor's browser for them, guest.ts): from the courses not drawn yet this round (bag),
 * never the one drawn last. Once every course has had its turn the round starts again, still not with the last one;
 * a course added later is in the very next draw. Only with a single course is the same one drawn twice in a row.
 * random is given from outside (Math.random, or a test's), a number from 0 up to 1.
 */
export function drawCourse<C extends string>(
  { bag, last }: { bag: readonly string[]; last: string | null },
  courses: readonly C[],
  random: () => number,
): { course: C; bag: C[] } {
  const live = [...new Set(courses)];
  if (!live.length) throw new Error("No course to draw");
  // what this round drew, of the courses there are now
  let round = live.filter((c) => bag.includes(c));
  let pool = live.filter((c) => !round.includes(c) && c !== last);
  if (!pool.length) {
    round = [];
    pool = live.filter((c) => c !== last);
    if (!pool.length) pool = live;
  }
  const course = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return { course, bag: [...round, course] };
}
