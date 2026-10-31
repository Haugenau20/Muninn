import React from 'react';
import { NPC } from '../types';
import Typography from '../../../../core/components/Typography';
import { RosterName, RosterStatus, type RosterStatusTone } from 'core/components/Roster';
import PrivateMark from 'shared/components/private/PrivateMark';

/** Column template shared by every row, so the columns line up across groups. */
export const NPC_ROW_GRID =
  'grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.5fr)_112px_132px_minmax(0,1.15fr)_26px]';

/**
 * An NPC's stance toward the party. Valenced, unlike presence below.
 *
 * `unknown` maps to `unsure` rather than sharing a name with presence's
 * `unknown`: they are different claims -- one is "we have not recorded where
 * this person stands", the other "we do not know whether they are alive".
 */
// `Partial<>` is load-bearing, not pedantry. As a plain `Record<string, T>`
// the index access is typed non-nullable, so TypeScript treats the `?? fallback`
// at the call site as unreachable and **never checks it** -- which is how a
// `?? 'unknown'` naming a tone that no longer exists survived 12-3a's rename
// and would have rendered no class at all. `Partial` makes the lookup
// `T | undefined`, so the fallback is type-checked like any other value.
const DISPOSITION_TONE: Partial<Record<string, RosterStatusTone>> = {
  friendly: 'friendly',
  neutral: 'neutral',
  hostile: 'hostile',
  unknown: 'unsure',
};

/**
 * NPC presence carries no hue, deliberately.
 *
 * Alive was green and deceased was red, which reads a death as an error. It is
 * a fact about the world with no valence -- a slain villain is not a bad
 * outcome -- so alive is plain ink, deceased is muted ink, and only `missing`
 * takes a hue, because genuine uncertainty is what the knowledge ladder's
 * first rung means. 12-5 adds the strike that makes deceased legible without
 * leaning on weight alone. Schema section 3.
 */
// NPC presence is the one scale with four ranks, so it takes four stops
// instead of the three a rumour or a location needs. It keeps the ramp's ends
// -- alive is the same green a completed quest is, deceased the same red a
// failed one is -- and spends stops 1 and 3 on the two middles, which is what
// finally separates "we have no record of them" from "we know they are lost".
const STATUS_TONE: Partial<Record<string, RosterStatusTone>> = {
  alive: 'valence-0',
  unknown: 'valence-1',
  missing: 'valence-2',
  deceased: 'valence-3',
};

/** What a collapsed NPC row shows, and nothing it does not. */
export type NPCRowFacts = Pick<NPC, 'name' | 'title' | 'status' | 'relationship' | 'occupation' | 'isPrivate'>;

/**
 * The cells of a collapsed NPC row: name and title, presence, stance,
 * occupation. Laid out on {@link NPC_ROW_GRID}.
 *
 * A component of its own so the directory and the example a signed-out
 * visitor sees (`NPCExample`, T150) draw the same row; an example that copied this markup
 * would drift from it with the first redesign.
 */
const NPCRowCells: React.FC<{ npc: NPCRowFacts }> = ({ npc }) => (
  <>
    <RosterName name={npc.name} detail={npc.title} badge={npc.isPrivate ? <PrivateMark /> : undefined} />

    <RosterStatus
      tone={STATUS_TONE[npc.status] ?? 'valence-1'}
      negated={npc.status === 'deceased'}
    >
      {npc.status.charAt(0).toUpperCase() + npc.status.slice(1)}
    </RosterStatus>

    {/* Disposition, and it takes its own hue again.
        It was muted for a real reason: as a filled chip in the status
        hue, a green "Alive" sat beside a green "Friendly" and read as
        one fact twice. That collision is gone -- presence now carries
        no hue at all -- so the scale that genuinely is valenced can
        have one. A hostile NPC is a threat to the reader, which is a
        different claim from anything presence makes. */}
    <RosterStatus
      tone={DISPOSITION_TONE[npc.relationship] ?? 'unsure'}
      className="justify-self-start"
    >
      {npc.relationship.charAt(0).toUpperCase() + npc.relationship.slice(1)}
    </RosterStatus>

    <Typography
      variant="body-sm"
      color="secondary"
      className="hidden md:block text-sm truncate"
    >
      {npc.occupation || '—'}
    </Typography>
  </>
);

export default NPCRowCells;
