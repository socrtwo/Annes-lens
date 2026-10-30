/**
 * Several AIs for text commands (shared with the suite):
 * - single: the active text service answers;
 * - master: every member answers, then the master service combines the answers into one;
 * - quaker: members answer, read each other's answers and revise, round by round, until they agree
 *   (or three rounds pass); the last round's answers are merged by the first member.
 * The deliberation (every draft) is kept for Show AI Discussion.
 */
import type { AiService, ChatRequest } from './types';

export type Ask = (s: AiService, r: ChatRequest) => Promise<string>;

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

export async function runEnsemble(mode: 'single' | 'master' | 'quaker', members: AiService[], master: AiService, r: ChatRequest, ask: Ask): Promise<{ text: string; deliberation: string; service: string; model: string }> {
  if (mode === 'single' || members.length < 2) {
    const s = members[0] || master;
    return { text: await ask(s, r), deliberation: '', service: s.name, model: s.textModel };
  }
  const log: string[] = [];
  const firsts = await Promise.all(members.map(async (s) => { try { return await ask(s, r); } catch (e) { return `(${s.name} failed: ${(e as Error).message})`; } }));
  members.forEach((s, i) => log.push(`## ${s.name} (${s.textModel}), round 1\n${firsts[i]}`));
  const task = r.messages[r.messages.length - 1]?.text || '';
  const json = r.json ? ' Keep the same JSON shape as the answers.' : '';
  if (mode === 'master') {
    const combine: ChatRequest = { ...r, messages: [...r.messages.slice(0, -1), { role: 'user', text: `${task}\n\nSeveral assistants answered this. Combine their answers into the single best answer, keeping what they agree on and resolving differences carefully. Answer only with the combined result.${json}\n\n${members.map((s, i) => `--- ${s.name} ---\n${firsts[i]}`).join('\n\n')}`, images: r.messages[r.messages.length - 1]?.images }] };
    const text = await ask(master, combine);
    log.push(`## Master: ${master.name} (${master.textModel})\n${text}`);
    return { text, deliberation: log.join('\n\n'), service: `${master.name} (master of ${members.length})`, model: master.textModel };
  }
  let answers = firsts;
  for (let round = 2; round <= 3; round++) {
    if (answers.every((a) => same(a, answers[0]))) break;
    const next = await Promise.all(members.map(async (s, i) => {
      const others = members.map((o, j) => (j === i ? null : `--- ${o.name} ---\n${answers[j]}`)).filter(Boolean).join('\n\n');
      const req: ChatRequest = { ...r, messages: [...r.messages.slice(0, -1), { role: 'user', text: `${task}\n\nYour earlier answer:\n${answers[i]}\n\nOther assistants answered:\n${others}\n\nSeeking agreement, give your revised answer (only the answer; keep it if you still hold it).${json}`, images: r.messages[r.messages.length - 1]?.images }] };
      try { return await ask(s, req); } catch { return answers[i]; }
    }));
    answers = next;
    members.forEach((s, i) => log.push(`## ${s.name}, round ${round}\n${answers[i]}`));
  }
  const agreed = answers.every((a) => same(a, answers[0]));
  let text = answers[0];
  if (!agreed) {
    const merge: ChatRequest = { ...r, messages: [...r.messages.slice(0, -1), { role: 'user', text: `${task}\n\nThese answers did not fully converge. State the consensus: what all agree on, resolving the rest by the best-supported view. Answer only with the result.${json}\n\n${members.map((s, i) => `--- ${s.name} ---\n${answers[i]}`).join('\n\n')}`, images: r.messages[r.messages.length - 1]?.images }] };
    text = await ask(members[0], merge);
    log.push(`## Consensus by ${members[0].name}\n${text}`);
  } else log.push('## Consensus reached');
  return { text, deliberation: log.join('\n\n'), service: `${members.map((m) => m.name).join(' + ')} (consensus)`, model: members.map((m) => m.textModel).join(', ') };
}
