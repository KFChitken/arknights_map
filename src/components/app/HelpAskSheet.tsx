"use client";

import { useState } from "react";
import { fmt, fmtParts, T } from "@/i18n";
import { GAME_NAMES, type Game } from "@/lib/games";
import { CLUES, HELP_GAMES, HELP_HOURS, HELP_KINDS, HELP_NAMES, helpText, SKILLS, type HelpAsk, type HelpKind } from "@/lib/help";
import { CharacterPicker } from "./ProfileSheet";
import Sheet from "./Sheet";

const toggle = (list: number[], n: number) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));

/**
 * 发求助 (src/lib/help.ts): 缺线索 (which, 1–7), 来线索交流, or 借助战 (one operator, which
 * skill), for a game you play; all picked, nothing typed. Shows what 触须之交 will read.
 */
export default function HelpAskSheet({
  games,
  busy,
  onSend,
  onBack,
  onClose,
}: {
  /** The games on your profile; none: all of them */
  games: Game[];
  busy: boolean;
  onSend: (ask: HelpAsk) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const allowed = (k: HelpKind) => HELP_GAMES[k].filter((g) => !games.length || games.includes(g));
  const kinds = HELP_KINDS.filter((k) => allowed(k).length > 0);
  const [kind, setKind] = useState<HelpKind>(kinds[0] ?? "clues");
  const [game, setGame] = useState<Game>(allowed(kinds[0] ?? "clues")[0] ?? "arknights");
  const [clues, setClues] = useState<number[]>([]);
  const [operator, setOperator] = useState<string[]>([]);
  const [skill, setSkill] = useState<number>(0);

  const pickKind = (k: HelpKind) => {
    setKind(k);
    const gs = allowed(k);
    if (!gs.includes(game)) setGame(gs[0] ?? HELP_GAMES[k][0]);
  };
  const ask: HelpAsk =
    kind === "clues" ? { kind, game, clues } : kind === "support" ? { kind, game: "arknights", operator: operator[0], skill } : { kind, game };
  const ready = kind === "clues" ? clues.length > 0 : kind === "support" ? operator.length > 0 : true;
  const gameChoices = allowed(kind);

  return (
    <Sheet title={T.help.ask.title} onBack={onBack} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        {fmtParts(T.help.ask.note, { hours: HELP_HOURS })}
      </p>
      <div className="chips">
        {kinds.map((k) => (
          <button key={k} type="button" className={`chip${kind === k ? " on" : ""}`} onClick={() => pickKind(k)}>
            {HELP_NAMES[k]}
          </button>
        ))}
      </div>
      {gameChoices.length > 1 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {gameChoices.map((g) => (
            <button key={g} type="button" className={`chip${game === g ? " on" : ""}`} onClick={() => setGame(g)}>
              {GAME_NAMES[g]}
            </button>
          ))}
        </div>
      )}
      {kind === "clues" && (
        <>
          <h3>{T.help.ask.cluesLabel}</h3>
          <div className="chips">
            {CLUES.map((n) => (
              <button key={n} type="button" className={`chip${clues.includes(n) ? " on" : ""}`} onClick={() => setClues(toggle(clues, n))}>
                {fmtParts(T.help.clue, { n: n })}
              </button>
            ))}
          </div>
        </>
      )}
      {kind === "support" && (
        <>
          <h3>{T.help.ask.operatorLabel}</h3>
          <CharacterPicker game="arknights" value={operator} max={1} addLabel={T.common.pickOperator} onChange={setOperator} />
          <h3>{T.help.ask.skillLabel}</h3>
          <div className="chips">
            {SKILLS.map((n) => (
              <button key={n} type="button" className={`chip${skill === n ? " on" : ""}`} onClick={() => setSkill(n)}>
                {n ? fmt(T.help.ask.skill, { n }) : T.help.ask.anySkill}
              </button>
            ))}
          </div>
        </>
      )}
      {ready && <p className="help-preview">{fmtParts(T.help.ask.preview, { text: helpText(ask) })}</p>}
      <button type="button" className="primary wide" style={{ marginTop: 14 }} disabled={busy || !ready} onClick={() => onSend(ask)}>
        {T.help.ask.send}
      </button>
    </Sheet>
  );
}
