export const CHARACTERS = [
  {
    id: 'aoi', name: 'Aoi Tsukishiro', epithet: 'The Watcher', club: 'Astronomy Circle',
    personality: 'Observant · composed · quietly brave',
    bio: 'Aoi spends late evenings charting the stars from the academy roof. She notices small changes others overlook, but rarely explains how she knows.',
    image: '/assets/characters/aoi.webp', accent: '#a99be9'
  },
  {
    id: 'ren', name: 'Ren Kisaragi', epithet: 'The Transfer', club: 'Literature Society',
    personality: 'Guarded · clever · hard to read',
    bio: 'Ren arrived midway through term with a sealed record and a habit of asking questions back. He prefers old books to easy answers.',
    image: '/assets/characters/ren.webp', accent: '#9bb8d5'
  },
  {
    id: 'mika', name: 'Mika Hoshino', epithet: 'The Bright Note', club: 'Academy Choir',
    personality: 'Warm · perceptive · quietly determined',
    bio: 'Mika remembers the sound of every corridor at night. Her kindness makes people speak freely—and she remembers every word.',
    image: '/assets/characters/mika.webp', accent: '#d0a8ee'
  },
  {
    id: 'haruto', name: 'Haruto Kuroda', epithet: 'The Captain', club: 'Kendo Team',
    personality: 'Direct · loyal · protective',
    bio: 'As captain, Haruto believes a promise should be kept even when it is difficult. He trusts actions more than rumours.',
    image: '/assets/characters/haruto.webp', accent: '#e59a78'
  },
  {
    id: 'yuna', name: 'Yuna Amamiya', epithet: 'The Chronicle', club: 'Student Press',
    personality: 'Curious · confident · quick-witted',
    bio: 'Yuna runs the school paper and collects stories other students leave unfinished. Her notebook is always open, even after curfew.',
    image: '/assets/characters/yuna.webp', accent: '#9dcc9f'
  },
  {
    id: 'sota', name: 'Sota Fujimori', epithet: 'The Archivist', club: 'Library Volunteers',
    personality: 'Methodical · thoughtful · shyly funny',
    bio: 'Sota knows where every forgotten record is kept. He checks the details twice—and makes one dry joke when the tension gets too high.',
    image: '/assets/characters/sota.webp', accent: '#84c4c4'
  }
];

export const CHARACTER_EXPRESSIONS = {
  aoi: ['neutral', 'happy', 'surprised', 'suspicious', 'worried', 'sad'],
  ren: ['neutral', 'serious', 'angry', 'shocked', 'nervous', 'smirking'],
  mika: ['neutral', 'happy', 'sad', 'frightened', 'surprised', 'determined'],
  haruto: ['neutral', 'confident', 'angry', 'suspicious', 'surprised', 'relieved'],
  yuna: ['neutral', 'curious', 'excited', 'worried', 'shocked', 'smiling'],
  sota: ['neutral', 'analytical', 'confused', 'nervous', 'surprised', 'pleased']
};

export function getExpressionImage(id, expression) {
  return CHARACTER_EXPRESSIONS[id]?.includes(expression)
    ? `/assets/characters/expressions/${id}/${expression}.webp`
    : null;
}

export function getCharacter(id) {
  return CHARACTERS.find((character) => character.id === id) || CHARACTERS[0];
}
