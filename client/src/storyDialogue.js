import { CHARACTERS, getCharacter } from './characters.js';
const CHARACTER_IDS = new Set(CHARACTERS.map(({ id }) => id));

// Six fixed, role-neutral story beats. Every character has a voice-matched
// version of each beat so smaller rooms can carry the full setup themselves.
const BEATS = [
  {
    mood: 'surprise',
    lines: {
      aoi: 'I noticed the academy bell stopped at 12:07—the exact minute the archive was opened.',
      ren: '12:07. The bell stopped then. That timing is too precise to ignore.',
      mika: 'The bell stopped at 12:07… right when the archive was opened. That feels awful.',
      haruto: 'The bell stopped at 12:07, the very minute the archive was opened. We should remember that.',
      yuna: 'Wait—the bell stopped at 12:07? That is exactly when someone opened the archive!',
      sota: 'The bell stopped at 12:07. Its timing matches the archive opening exactly.'
    }
  },
  {
    mood: 'focus',
    lines: {
      aoi: 'The lock looks untouched. I think the door was opened with a key, not forced.',
      ren: 'No damage on the lock. A key was used; whoever carried it knew the door.',
      mika: 'There is no mark on the lock. Someone must have opened it with a key…',
      haruto: 'The lock is intact; someone used a key. Let us follow the evidence carefully.',
      yuna: 'No scratches on the lock! So a key opened it—now I want to know what else was left behind.',
      sota: 'The lock shows no forced entry. The simplest explanation is that a key was used.'
    }
  },
  {
    mood: 'worry',
    lines: {
      aoi: 'The sealed document is missing. The Head Librarian said it could never leave the archive.',
      ren: 'The document is gone. The Head Librarian was clear: it was never to leave the archive.',
      mika: 'The sealed document is gone. The Head Librarian trusted us to keep it safe…',
      haruto: 'The document is missing, but we can still recover it. We will not leave anyone behind.',
      yuna: 'The sealed document vanished! If we trace what happened, we can still bring it back.',
      sota: 'The sealed document is missing. Recovering it is the central objective of this case.'
    }
  },
  {
    mood: 'curiosity',
    lines: {
      aoi: 'Three places may hold the trail: the forbidden library, the moonlit corridor, and the clock tower.',
      ren: 'The Forbidden Library, moonlit corridor, clock tower. We check those three locations and follow what does not fit.',
      mika: 'Let us search the forbidden library, the moonlit corridor, and the clock tower together.',
      haruto: 'We will search the Forbidden Library, moonlit corridor, and clock tower as a team. Stay close.',
      yuna: 'Three locations to explore: the forbidden library, the moonlit corridor, and the clock tower. Let us go!',
      sota: 'The search areas are the forbidden library, moonlit corridor, and clock tower. That gives us a clear route.'
    }
  },
  {
    mood: 'resolve',
    lines: {
      aoi: 'We have three rounds to examine clues, compare what we notice, and choose our next lead.',
      ren: 'Three rounds. We inspect the clues, compare notes, then choose which lead to pursue.',
      mika: 'We have three rounds to search and share what we find. No one has to work this out alone.',
      haruto: 'Three rounds to investigate. We share our evidence and decide together where to look next.',
      yuna: 'Three rounds! We can inspect clues, compare discoveries, and pick the most promising lead.',
      sota: 'The investigation has three rounds. Each ends with a group choice based on the evidence collected.'
    }
  },
  {
    mood: 'resolve',
    lines: {
      aoi: 'At the final bell, we will compare every clue and identify the culprit who took the document.',
      ren: 'When the final bell rings, we name the culprit. No guesswork—only what the evidence supports.',
      mika: 'At the end, we will put the clues together and find the culprit who took the document.',
      haruto: 'We will see this through. At the final bell, we use the evidence to identify the culprit.',
      yuna: 'Then, at the final bell, we solve it together and find the culprit who took the document!',
      sota: 'At the final bell, we evaluate the evidence and identify the culprit. Every clue matters.'
    }
  }
];

const EXPRESSIONS = {
  surprise: { aoi: 'surprised', ren: 'shocked', mika: 'surprised', haruto: 'surprised', yuna: 'shocked', sota: 'surprised' },
  focus: { aoi: 'neutral', ren: 'serious', mika: 'determined', haruto: 'confident', yuna: 'curious', sota: 'analytical' },
  worry: { aoi: 'worried', ren: 'nervous', mika: 'sad', haruto: 'confident', yuna: 'worried', sota: 'nervous' },
  curiosity: { aoi: 'neutral', ren: 'serious', mika: 'surprised', haruto: 'confident', yuna: 'curious', sota: 'analytical' },
  resolve: { aoi: 'happy', ren: 'serious', mika: 'determined', haruto: 'confident', yuna: 'excited', sota: 'pleased' }
};

const FALLBACK_EXPRESSION = {
  aoi: 'neutral', ren: 'neutral', mika: 'neutral', haruto: 'neutral', yuna: 'neutral', sota: 'neutral'
};

export function getOpeningDialogue(activeCast = []) {
  const speakers = [...new Set(activeCast)]
    .filter((characterId) => CHARACTER_IDS.has(characterId));
  if (!speakers.length) return [];

  return BEATS.map((beat, index) => {
    const characterId = speakers[index % speakers.length];
    const character = getCharacter(characterId);
    return {
      characterId,
      speakerName: character.name,
      text: beat.lines[characterId],
      expression: EXPRESSIONS[beat.mood]?.[characterId] || FALLBACK_EXPRESSION[characterId] || 'neutral',
      mood: beat.mood
    };
  });
}
