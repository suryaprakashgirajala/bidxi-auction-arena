'use strict';

const ROLE_WEIGHTS = Object.freeze({
  Batter: 0.28,
  Bowler: 0.28,
  'All Rounder': 0.26,
  'Wicket Keeper': 0.18
});

const DIFFICULTY = Object.freeze({
  EASY: { valuation: 0.88, willingness: 0.72, patience: 1.18 },
  MEDIUM: { valuation: 1.00, willingness: 0.92, patience: 1.00 },
  HARD: { valuation: 1.12, willingness: 1.08, patience: 0.88 }
});

const PERSONALITIES = Object.freeze({
  AGGRESSIVE: {
    valuation: 1.20,
    willingness: 1.24,
    starBias: 0.04,
    valueBias: -0.02,
    needBias: 0.10,
    label: 'Aggressive bidder'
  },
  DEFENSIVE: {
    valuation: 0.84,
    willingness: 0.76,
    starBias: -0.02,
    valueBias: 0.08,
    needBias: 0.02,
    label: 'Budget controller'
  },
  BALANCED: {
    valuation: 1.00,
    willingness: 0.96,
    starBias: 0.01,
    valueBias: 0.03,
    needBias: 0.08,
    label: 'Balanced strategist'
  },
  VALUE_HUNTER: {
    valuation: 0.94,
    willingness: 0.88,
    starBias: -0.04,
    valueBias: 0.20,
    needBias: 0.12,
    label: 'Value hunter'
  },
  STAR_HUNTER: {
    valuation: 1.18,
    willingness: 1.02,
    starBias: 0.24,
    valueBias: -0.06,
    needBias: 0.06,
    label: 'Star hunter'
  }
});

const MINIMUM_AUCTION_PRICE = 0.1;

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function targetRoleCounts(maxSquadSize) {
  const total = Math.max(1, Math.floor(Number(maxSquadSize) || 1));
  const roles = Object.keys(ROLE_WEIGHTS);
  const raw = roles.map((role) => ({ role, exact: total * ROLE_WEIGHTS[role] }));
  const targets = raw.map((item) => ({ role: item.role, count: Math.floor(item.exact), remainder: item.exact - Math.floor(item.exact) }));
  let left = total - targets.reduce((sum, item) => sum + item.count, 0);
  targets.sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < left; index += 1) targets[index % targets.length].count += 1;
  return Object.fromEntries(targets.map((item) => [item.role, item.count]));
}

function countRoles(players = []) {
  return players.reduce((counts, player) => {
    const role = player.role || 'Other';
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

function getPlayerRating(player) {
  // Arena ratings are in-game balancing values, not official cricket statistics.
  const rating = Number(player?.arenaRating);
  if (Number.isFinite(rating)) return clamp(rating, 50, 99);
  const basePrice = Math.max(MINIMUM_AUCTION_PRICE, Number(player?.basePrice) || 1);
  return clamp(70 + basePrice * 5, 65, 82);
}

function getRoleNeed(team, player, maxSquadSize) {
  const targets = targetRoleCounts(maxSquadSize);
  const counts = countRoles(team.players);
  const target = targets[player.role] || 0;
  if (!target) return 0;
  return clamp((target - (counts[player.role] || 0)) / target, 0, 1);
}

function countRemainingByRole(room, role) {
  const auction = room.auction;
  if (!auction?.playerOrder) return 0;
  return auction.playerOrder
    .slice(auction.playerIndex + 1)
    .filter((player) => player.role === role).length;
}

function getBudgetReserve(team, room) {
  const slotsAfterPurchase = Math.max(0, room.settings.maxSquadSize - team.players.length - 1);
  const availablePrices = (room.auction?.playerOrder || []).map((player) => Number(player.basePrice) || MINIMUM_AUCTION_PRICE);
  const minBasePrice = availablePrices.length ? Math.max(MINIMUM_AUCTION_PRICE, Math.min(...availablePrices)) : MINIMUM_AUCTION_PRICE;
  return round2(slotsAfterPurchase * minBasePrice);
}

function assessBotBid(room, team, nextBid) {
  const auction = room.auction;
  const player = auction?.currentPlayer;
  if (!room || !team || !player || team.ownerType !== 'BOT') return null;
  if (team.id === auction.highestBidTeamId) return null;
  if ((auction.passedTeamIds || []).includes(team.id)) return null;
  if (team.players.length >= room.settings.maxSquadSize) return null;

  const purse = Math.max(0, Number(team.purse) || 0);
  const basePrice = Math.max(MINIMUM_AUCTION_PRICE, Number(player.basePrice) || MINIMUM_AUCTION_PRICE);
  const reserve = getBudgetReserve(team, room);
  const spendable = Math.max(0, purse - reserve);
  if (spendable + 0.001 < nextBid) return null;

  const difficulty = DIFFICULTY[room.settings.botDifficulty] || DIFFICULTY.MEDIUM;
  const personality = PERSONALITIES[team.personality] || PERSONALITIES.BALANCED;
  const rating = getPlayerRating(player);
  const roleNeed = getRoleNeed(team, player, room.settings.maxSquadSize);
  const roleCount = countRoles(team.players)[player.role] || 0;
  const targets = targetRoleCounts(room.settings.maxSquadSize);
  const roleTarget = targets[player.role] || 0;
  const playersRemainingInRole = countRemainingByRole(room, player.role);
  const roleShortage = Math.max(0, roleTarget - roleCount);
  const scarcity = roleShortage > 0
    ? clamp(roleShortage / Math.max(1, playersRemainingInRole + 1), 0, 1)
    : 0;

  const initialPurse = Math.max(1, Number(room.settings.initialPurse) || 120);
  const budgetRatio = clamp(purse / initialPurse, 0, 1);
  const slotsLeft = Math.max(1, room.settings.maxSquadSize - team.players.length);
  const averageBudgetPerSlot = spendable / slotsLeft;
  const budgetPressure = clamp(averageBudgetPerSlot / Math.max(1, initialPurse / room.settings.maxSquadSize), 0, 1.5);

  const qualityPremium = Math.max(0, rating - 70) * 0.075;
  const needPremium = roleNeed * 0.58 + scarcity * 0.32;
  const baseMultiplier = 1.75 + qualityPremium + needPremium;
  const personalityMultiplier = personality.valuation;
  const targetPrice = basePrice * baseMultiplier * personalityMultiplier * difficulty.valuation;
  const budgetMultiplier = clamp(0.72 + budgetRatio * 0.46 + (budgetPressure - 1) * 0.12, 0.62, 1.18);
  const maxBid = round2(Math.min(spendable, targetPrice * budgetMultiplier));
  if (maxBid + 0.001 < nextBid) return null;

  const pricePressure = clamp(nextBid / Math.max(basePrice, maxBid), 0, 1.5);
  const qualityScore = (rating - 70) / 29;
  const roleFit = roleNeed * 0.30 + scarcity * 0.16;
  const stage = auction.playerOrder.length > 0 ? auction.playerIndex / auction.playerOrder.length : 0;
  const lateAuctionNeed = stage > 0.72 && roleNeed > 0 ? 0.08 : 0;
  const bargainScore = clamp((maxBid - nextBid) / Math.max(1, maxBid), 0, 1);
  const starInterest = Math.max(0, qualityScore) * personality.starBias;
  const valueInterest = bargainScore * personality.valueBias;
  const willingness = clamp(
    (0.34 + roleFit + qualityScore * 0.10 + lateAuctionNeed + personality.needBias + starInterest + valueInterest - pricePressure * 0.24) *
      personality.willingness * difficulty.willingness * difficulty.patience,
    0.03,
    0.94
  );

  const roleReason = roleNeed >= 0.65 || scarcity >= 0.65;
  const reason = roleReason
    ? 'filling a squad role'
    : rating >= 90 && team.personality === 'STAR_HUNTER'
      ? 'targeting a marquee player'
      : bargainScore >= 0.35
        ? 'spotting value at this price'
        : 'strengthening the squad';

  const priority = willingness * (0.55 + roleFit + qualityScore * 0.12) * (0.6 + bargainScore * 0.4);
  return {
    team,
    maxBid,
    nextBid: round2(nextBid),
    willingness,
    priority,
    roleNeed,
    scarcity,
    rating,
    reason,
    budgetReserve: reserve,
    spendable
  };
}

function chooseBotBid(room, teams, nextBid, random = Math.random) {
  const assessments = (teams || [])
    .map((team) => assessBotBid(room, team, nextBid))
    .filter(Boolean);

  if (!assessments.length) return null;
  assessments.sort((a, b) => b.priority - a.priority);

  // A little controlled variation keeps bots from making identical decisions every auction.
  const weighted = assessments.map((assessment) => ({
    assessment,
    roll: random() * (0.12 + (1 - assessment.willingness) * 0.22)
  }));
  weighted.sort((a, b) => (b.assessment.priority - b.roll) - (a.assessment.priority - a.roll));

  for (const entry of weighted) {
    if (random() <= entry.assessment.willingness) return entry.assessment;
  }
  return null;
}

function getPersonalityLabel(personality) {
  return PERSONALITIES[personality]?.label || PERSONALITIES.BALANCED.label;
}

module.exports = {
  DIFFICULTY,
  PERSONALITIES,
  assessBotBid,
  chooseBotBid,
  countRoles,
  getPersonalityLabel,
  getPlayerRating,
  getRoleNeed,
  targetRoleCounts
};
