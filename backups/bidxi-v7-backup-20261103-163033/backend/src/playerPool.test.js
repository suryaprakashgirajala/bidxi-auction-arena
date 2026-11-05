const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seedPlayers = require('./players.json');
const { buildPoolPreview, summarizeRemainingPlayers } = require('./playerPool');

const sample = [
  { id: 1, name: 'A Batter', role: 'Batter', nationality: 'India', basePrice: 1 },
  { id: 2, name: 'B Batter', role: 'Batter', nationality: 'Australia', basePrice: 2 },
  { id: 3, name: 'C Bowler', role: 'Bowler', nationality: 'India', basePrice: 1.5 },
  { id: 4, name: 'D Keeper', role: 'Wicket Keeper', nationality: 'South Africa', basePrice: 1 },
  { id: 5, name: 'E Allrounder', role: 'All Rounder', nationality: 'India', basePrice: 0.5 }
];

test('pool preview counts total, role, domestic and overseas players', () => {
  const preview = buildPoolPreview(sample);
  assert.equal(preview.totalPlayers, 5);
  const batters = preview.categories.find((category) => category.key === 'Batter');
  assert.equal(batters.total, 2);
  assert.equal(batters.domesticCount, 1);
  assert.equal(batters.overseasCount, 1);
  assert.deepEqual(batters.overseasPlayers.map((player) => player.name), ['B Batter']);
});

test('remaining player summary starts at the current player index', () => {
  const summary = summarizeRemainingPlayers({ playerOrder: sample, playerIndex: 1 });
  assert.equal(summary.reduce((total, category) => total + category.total, 0), 4);
  assert.equal(summary.find((category) => category.key === 'Batter').total, 1);
  assert.equal(summary.find((category) => category.key === 'Bowler').domesticCount, 1);
});

test('empty pool and missing auction are handled safely', () => {
  assert.equal(buildPoolPreview([]).totalPlayers, 0);
  assert.deepEqual(summarizeRemainingPlayers(null), []);
});


test('expanded seed pool contains 263 unique players with a profile image and valid auction role', () => {
  assert.equal(seedPlayers.length, 263);
  assert.equal(new Set(seedPlayers.map((player) => player.name.toLowerCase())).size, 263);
  const allowedRoles = new Set(['Batter', 'Bowler', 'Wicket Keeper', 'All Rounder']);
  const avatarRoot = path.resolve(__dirname, '../../frontend/public/player-avatars');
  for (const player of seedPlayers) {
    assert.ok(allowedRoles.has(player.role), `${player.name} has a supported role`);
    assert.ok(player.image, `${player.name} has a primary image`);
    const slug = player.name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    assert.ok(fs.existsSync(path.join(avatarRoot, `${slug}.svg`)), `${player.name} has a local fallback avatar`);
  }
});

test('pool review omits oversized embedded image data to keep multiplayer snapshots small', () => {
  const bigImage = `data:image/png;base64,${'A'.repeat(50000)}`;
  const preview = buildPoolPreview([{ id: 'custom-1', name: 'Large Image Player', role: 'Batter', nationality: 'India', basePrice: 1, image: bigImage }]);
  assert.equal(preview.categories.find((category) => category.key === 'Batter').domesticPlayers[0].image, null);
});
