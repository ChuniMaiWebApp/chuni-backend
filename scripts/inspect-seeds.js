/** Ad-hoc inspection of the seed datasets. `node scripts/inspect-seeds.js` */
const { join } = require('node:path');

const songs = require(join(__dirname, '..', 'data', 'songs.json'));
const charts = songs.flatMap((song) => song.charts);

console.log('songs                :', songs.length);
console.log(
  'total aliases        :',
  songs.reduce((total, song) => total + (song.aliases?.length ?? 0), 0),
);
console.log(
  'charts with sdvxin   :',
  charts.filter((chart) => chart.sdvxin).length,
);

const courses = require(join(__dirname, '..', 'data', 'courses.json'));
const tracks = courses.flatMap((course) => course.tracks ?? []);

console.log('courses              :', courses.length);
console.log('course tracks        :', tracks.length);
console.log(
  'tracks without charts:',
  tracks.filter((track) => !Array.isArray(track?.charts)).length,
);
console.log(
  'track keys seen      :',
  [...new Set(tracks.flatMap((track) => Object.keys(track ?? {})))].join(', '),
);

const odd = tracks.find((track) => !Array.isArray(track?.charts));
if (odd) console.log('odd track            :', JSON.stringify(odd).slice(0, 200));

const owner = courses.find((course) =>
  (course.tracks ?? []).some((track) => !Array.isArray(track?.charts)),
);
if (owner) {
  console.log(
    'owning course        :',
    JSON.stringify({ id: owner.id, name: owner.name, tracks: owner.tracks }).slice(0, 400),
  );
}
