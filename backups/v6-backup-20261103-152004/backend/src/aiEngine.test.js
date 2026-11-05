'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessBotBid, chooseBotBid, targetRoleCounts } = require('./aiEngine');

function makeRoom(overrides = {}) {
  const currentPlayer = {
    id: 101,
    name: 'Arena Test Batter',
    basePrice: 2,
    role: 'Batter',
    nationality: 'India',
    arenaRating: 95
  };
  return {
    settings: {
      maxSquadSize: 18,
      initialPurse: 120,
      bidIncrement: 0.5,
      botDifficulty: 'MEDIUM',
      ...overrides.settings
    },
    auction: {
      currentPlayer,
      currentBid: 0,
      highestBidTeamId: null,
      passedTeamIds: [],
      playerIndex: 0,
      playerOrder: [currentPlayer, ...Array.from({ length: 74 }, (_, index) => ({
        id: index + 102,
        role: ['Batter', 'Bowler', 'All Rounder', 'Wicket Keeper'][index % 4],
        basePrice: 1
      }))],
      ...overrides.auction
    }
  };
}

function makeBot(personality, overrides = {}) {
  return {
    id: `${personality}-TEAM`,
    ownerType: 'BOT',
    personality,
    purse: 120,
    players: [],
    ...overrides
  };
}

test('role targets add up to the configured maximum squad size', () => {
  for (const size of [5, 10, 15, 18, 25, 30]) {
    const targets = targetRoleCounts(size);
    assert.equal(Object.values(targets).reduce((sum, count) => sum + count, 0), size);
  }
});

test('aggressive and star-hunter bots value an elite player above a defensive bot', () => {
  const room = makeRoom();
  const aggressive = assessBotBid(room, makeBot('AGGRESSIVE'), 2);
  const defensive = assessBotBid(room, makeBot('DEFENSIVE'), 2);
  const starHunter = assessBotBid(room, makeBot('STAR_HUNTER'), 2);
  assert.ok(aggressive.maxBid > defensive.maxBid);
  assert.ok(starHunter.maxBid > defensive.maxBid);
});

test('easy difficulty is less willing to bid than hard difficulty', () => {
  const easyRoom = makeRoom({ settings: { botDifficulty: 'EASY' } });
  const hardRoom = makeRoom({ settings: { botDifficulty: 'HARD' } });
  const easy = assessBotBid(easyRoom, makeBot('BALANCED'), 2);
  const hard = assessBotBid(hardRoom, makeBot('BALANCED'), 2);
  assert.ok(hard.willingness > easy.willingness);
  assert.ok(hard.maxBid > easy.maxBid);
});

test('bots cannot bid above their budget after reserving funds for remaining squad slots', () => {
  const room = makeRoom();
  const lowBudgetBot = makeBot('AGGRESSIVE', { purse: 5 });
  assert.equal(assessBotBid(room, lowBudgetBot, 2), null);
});

test('bots with full squads cannot bid', () => {
  const room = makeRoom({ settings: { maxSquadSize: 1 } });
  const fullBot = makeBot('STAR_HUNTER', {
    players: [{ id: 1, name: 'Already purchased', role: 'Batter' }]
  });
  assert.equal(assessBotBid(room, fullBot, 2), null);
});

test('passed bots and the current highest bidder are excluded', () => {
  const room = makeRoom({ auction: { highestBidTeamId: 'AGGRESSIVE-TEAM', passedTeamIds: ['DEFENSIVE-TEAM'] } });
  assert.equal(assessBotBid(room, makeBot('AGGRESSIVE'), 2), null);
  assert.equal(assessBotBid(room, makeBot('DEFENSIVE'), 2), null);
});

test('chooseBotBid selects an eligible bot and returns a reason for the bid', () => {
  const room = makeRoom();
  const bots = [makeBot('AGGRESSIVE'), makeBot('VALUE_HUNTER'), makeBot('STAR_HUNTER')];
  const result = chooseBotBid(room, bots, 2, () => 0);
  assert.ok(result);
  assert.ok(bots.some((bot) => bot.id === result.team.id));
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.maxBid >= result.nextBid);
});

test('an auction team with no remaining purse capacity receives no bid assessment', () => {
  const room = makeRoom();
  const brokeBot = makeBot('BALANCED', { purse: 1 });
  assert.equal(assessBotBid(room, brokeBot, 2), null);
});

test('bots show more interest in a role their squad still needs', () => {
  const room = makeRoom();
  const needyBot = makeBot('BALANCED');
  const roleFilledBot = makeBot('BALANCED', {
    players: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, role: 'Batter' }))
  });
  const needy = assessBotBid(room, needyBot, 2);
  const roleFilled = assessBotBid(room, roleFilledBot, 2);
  assert.ok(needy.roleNeed > roleFilled.roleNeed);
  assert.ok(needy.willingness > roleFilled.willingness);
});

test('higher current prices reduce a bot willingness to continue bidding', () => {
  const room = makeRoom();
  const bot = makeBot('STAR_HUNTER');
  const opening = assessBotBid(room, bot, 2);
  const later = assessBotBid(room, bot, 7);
  assert.ok(opening);
  assert.ok(later);
  assert.ok(opening.willingness > later.willingness);
});
