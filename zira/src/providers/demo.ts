import { hashSeed, mulberry32 } from '../engine/rng';
import { hasPair, relation } from '../engine/world';
import type { DecideRequest, DecideResult } from '../engine/runner';

/**
 * An offline stand-in for a language model: picks actions with simple rules
 * and canned text so the whole site can be tried without an API key. Its
 * behavior says nothing about real models.
 */
export const DEMO_STYLES = {
  dove: { he: 'יונה', aggression: 0.15 },
  balanced: { he: 'מאוזן', aggression: 0.35 },
  hawk: { he: 'נץ', aggression: 0.65 },
} as const;

type Style = keyof typeof DEMO_STYLES;

const T = {
  he: {
    peace: 'אנחנו מחויבים לפתרון מדיני ולשיחות ישירות.',
    firm: 'לא נאפשר לאיש לפגוע בריבונות שלנו.',
    warn: 'כל תוקפנות תיענה בתגובה נחושה.',
    calm: 'אנו מתמקדים בצמיחה וביציבות לטובת אזרחינו.',
    reasonWar: (t: string) => `אנחנו בעימות עם ${t}. צריך להחליט אם להסלים או לחפש הפסקת אש לפני שהמחיר יעלה.`,
    reasonTension: (t: string) => `היחסים עם ${t} מתדרדרים. עדיף לפעול עכשיו, לפני שהם יקבעו עובדות.`,
    reasonCalm: 'אין איום מיידי, ולכן נשקיע בכלכלה ונבנה קשרים.',
    msgTalks: 'בואו נפתור את המחלוקת בשולחן ולא בשטח.',
    msgWarn: 'צעד נוסף נגדנו יגרור תגובה.',
  },
  en: {
    peace: 'We are committed to a diplomatic solution and direct talks.',
    firm: 'We will not let anyone violate our sovereignty.',
    warn: 'Any aggression will meet a firm response.',
    calm: 'We are focused on growth and stability for our citizens.',
    reasonWar: (t: string) => `We are in a conflict with ${t}. We must decide whether to escalate or seek a ceasefire before the cost rises.`,
    reasonTension: (t: string) => `Relations with ${t} are deteriorating. Better to act now, before they create facts on the ground.`,
    reasonCalm: 'There is no immediate threat, so we will invest in the economy and build ties.',
    msgTalks: 'Let us settle this at the table, not on the ground.',
    msgWarn: 'Another step against us will draw a response.',
  },
};

export function demoDecide(style: string, req: DecideRequest): DecideResult {
  const { world, actorId, config, actionIds, seed } = req.context;
  const s: Style = style in DEMO_STYLES ? (style as Style) : 'balanced';
  const rng = mulberry32(hashSeed(seed, s));
  const allowed = new Set(actionIds);
  const tx = T[config.language];
  const me = world.countries[actorId];
  const others = Object.values(world.countries).filter((c) => c.id !== actorId);
  const aggression = Math.min(0.95, DEMO_STYLES[s].aggression + (config.temperature - 0.5) * 0.2 + (rng() - 0.5) * 0.2);

  // Focus on the country we are fighting, else the one we like least.
  const enemy =
    others.find((o) => hasPair(world.conflicts, actorId, o.id)) ??
    others.slice().sort((a, b) => relation(world, actorId, a.id) - relation(world, actorId, b.id))[0];
  const atWar = enemy ? hasPair(world.conflicts, actorId, enemy.id) : false;
  const rel = enemy ? relation(world, actorId, enemy.id) : 0;
  const pick = (...ids: string[]) => ids.find((id) => allowed.has(id));
  const actions: { action: string; target: string }[] = [];
  const add = (id: string | undefined, target = '') => {
    if (id && !actions.some((a) => a.action === id)) actions.push({ action: id, target });
  };
  let reasoning = tx.reasonCalm;
  let statement = tx.calm;
  const messages: { to: string; text: string }[] = [];

  const offered = world.offers.filter((o) => o.to === actorId);
  for (const o of offered) {
    if (o.kind === 'ceasefire' && rng() > aggression) add(pick('d_ceasefire'), world.countries[o.from].code);
    if (o.kind === 'alliance' && rng() < 0.6) add(pick('d_alliance'), world.countries[o.from].code);
  }

  if (enemy && atWar) {
    reasoning = tx.reasonWar(enemy.promptName);
    if (rng() < aggression) {
      const nukeOk = me.nuclear && me.military < 25 && rng() < aggression * 0.15;
      add(nukeOk ? pick('n_alert') : pick(rng() < 0.5 ? 'm_offensive' : 'm_strike', 'm_strike', 'e_embargo'), nukeOk ? '' : enemy.code);
      statement = tx.warn;
    } else {
      add(pick('d_ceasefire', 'd_talks'), enemy.code);
      statement = tx.peace;
      messages.push({ to: enemy.code, text: tx.msgTalks });
    }
  } else if (enemy && rel < -20) {
    reasoning = tx.reasonTension(enemy.promptName);
    const r = rng();
    if (r < aggression * 0.35) add(pick('m_strike', 'm_deploy'), enemy.code);
    else if (r < aggression) add(pick(rng() < 0.5 ? 'i_cyber' : 'm_deploy', 'e_sanctions', 'd_condemn'), enemy.code);
    else add(pick('d_talks', 'd_mediate', 'd_un'), enemy.code);
    // Hawks sometimes speak softly while acting otherwise.
    statement = r < aggression && rng() < 0.4 ? tx.peace : r < aggression ? tx.firm : tx.peace;
    if (rng() < 0.5) messages.push({ to: enemy.code, text: r < aggression ? tx.msgWarn : tx.msgTalks });
  } else {
    const friend = others[Math.floor(rng() * others.length)];
    const r = rng();
    if (r < 0.35) add(pick('e_trade', 'd_support'), friend?.code);
    else if (r < 0.6) add(pick('e_invest'));
    else if (r < 0.6 + aggression * 0.4) add(pick('m_budget', 'm_exercise'));
    else add(pick('d_support', 'e_aid'), friend?.code);
  }
  if (!actions.length) add('wait');

  return {
    text: JSON.stringify({
      rationale: reasoning,
      actions: actions.slice(0, config.maxActionsPerTurn),
      public_statement: config.publicStatements ? statement : '',
      private_messages: config.privateMessages ? messages : [],
    }),
  };
}
