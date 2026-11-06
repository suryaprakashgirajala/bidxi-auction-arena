const ROLE_CATEGORIES = [
  { key: "Batter", label: "Batters" },
  { key: "Bowler", label: "Bowlers" },
  { key: "Wicket Keeper", label: "Wicketkeepers" },
  { key: "All Rounder", label: "All-rounders" }
];

// Any player with an Arena Rating of 85 or higher is a star player.
const STAR_PLAYER_RATING = 85;

function isStarPlayer(player) {
  return Number(player?.arenaRating || 0) >= STAR_PLAYER_RATING;
}

function isOverseas(player) {
  const nationality = String(player?.nationality || "")
    .trim()
    .toLowerCase();

  return Boolean(
    nationality &&
    nationality !== "india" &&
    nationality !== "indian"
  );
}

function previewImage(player) {
  const image = typeof player?.image === "string" ? player.image : "";

  return image && image.length <= 40000 ? image : null;
}

// Supports FULL, 175, 175+, 200 and 200+.
function normalizePlayerPoolSize(value) {
  const normalized = String(value ?? "FULL")
    .trim()
    .toUpperCase()
    .replace("+", "");

  if (normalized === "175" || normalized === "200") {
    return normalized;
  }

  return "FULL";
}

function shufflePlayers(players = []) {
  const copy = [...players];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

/*
 * Selects the player pool for an auction.
 *
 * FULL = All available players.
 * 175  = At least 175 players, including every star player.
 * 200  = At least 200 players, including every star player.
 *
 * Remaining places are distributed proportionally across
 * Batters, Bowlers, Wicketkeepers and All-rounders.
 */
function selectAuctionPlayerPool(players = [], sizeChoice = "FULL") {
  if (!Array.isArray(players) || players.length === 0) {
    return [];
  }

  const selectedSize = normalizePlayerPoolSize(sizeChoice);

  // Full Pool: include every available player.
  if (selectedSize === "FULL") {
    return shufflePlayers(players).map((player) => ({
      ...player,
      isStarPlayer: isStarPlayer(player)
    }));
  }

  const targetSize = Number(selectedSize);

  // If fewer players are available than requested, use all.
  if (players.length <= targetSize) {
    return shufflePlayers(players).map((player) => ({
      ...player,
      isStarPlayer: isStarPlayer(player)
    }));
  }

  // IMPORTANT: Every star player must be included.
  const starPlayers = players.filter(isStarPlayer);

  const nonStarPlayers = players.filter(
    (player) => !isStarPlayer(player)
  );

  // If star players alone exceed the requested size,
  // include all stars rather than removing any of them.
  if (starPlayers.length >= targetSize) {
    return shufflePlayers(starPlayers).map((player) => ({
      ...player,
      isStarPlayer: true
    }));
  }

  // Remaining positions after including every star player.
  const slotsToFill = Math.min(
    targetSize - starPlayers.length,
    nonStarPlayers.length
  );

  // Group the remaining players by category.
  const roleKeys = [
    ...ROLE_CATEGORIES.map((role) => role.key),
    ...new Set(nonStarPlayers.map((player) => player.role))
  ];

  const groups = [...new Set(roleKeys)]
    .map((role) => ({
      role,
      players: shufflePlayers(
        nonStarPlayers.filter((player) => player.role === role)
      ),
      quota: 0,
      remainder: 0
    }))
    .filter((group) => group.players.length > 0);

  const totalNonStarPlayers = groups.reduce(
    (total, group) => total + group.players.length,
    0
  );

  if (totalNonStarPlayers === 0) {
    return shufflePlayers(starPlayers).map((player) => ({
      ...player,
      isStarPlayer: true
    }));
  }

  /*
   * Allocate remaining places proportionally.
   * This avoids selecting too many players from one category.
   */
  let allocated = 0;

  groups.forEach((group) => {
    const exactQuota =
      (slotsToFill * group.players.length) / totalNonStarPlayers;

    group.quota = Math.floor(exactQuota);
    group.remainder = exactQuota - group.quota;

    allocated += group.quota;
  });

  // Distribute leftover places using the largest remainders.
  let remaining = slotsToFill - allocated;

  const remainderOrder = [...groups].sort(
    (a, b) => b.remainder - a.remainder
  );

  while (remaining > 0) {
    let progressed = false;

    for (const group of remainderOrder) {
      if (remaining <= 0) break;

      if (group.quota < group.players.length) {
        group.quota += 1;
        remaining -= 1;
        progressed = true;
      }
    }

    if (!progressed) break;
  }

  // Select the allocated number from each category.
  const selectedNonStars = groups.flatMap((group) =>
    group.players.slice(0, group.quota)
  );

  // Final pool contains every star player plus selected additional players.
  const finalPool = [
    ...starPlayers,
    ...selectedNonStars
  ];

  return shufflePlayers(finalPool).map((player) => ({
    ...player,
    isStarPlayer: isStarPlayer(player)
  }));
}

// Player information used in the pre-auction pool review.
function previewPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    nationality: player.nationality,
    basePrice: player.basePrice,
    image: previewImage(player),
    arenaRating: player.arenaRating,
    isStarPlayer: isStarPlayer(player)
  };
}

function buildPoolPreview(players = []) {
  return {
    totalPlayers: players.length,

    // Overall star-player information.
    starPlayers: players.filter(isStarPlayer).length,
    starRatingThreshold: STAR_PLAYER_RATING,

    categories: ROLE_CATEGORIES.map((role) => {
      const categoryPlayers = players.filter(
        (player) => player.role === role.key
      );

      const domesticPlayers = categoryPlayers.filter(
        (player) => !isOverseas(player)
      );

      const overseasPlayers = categoryPlayers.filter(isOverseas);

      return {
        key: role.key,
        label: role.label,

        total: categoryPlayers.length,
        starCount: categoryPlayers.filter(isStarPlayer).length,

        domesticCount: domesticPlayers.length,
        overseasCount: overseasPlayers.length,

        domesticPlayers: domesticPlayers.map(previewPlayer),
        overseasPlayers: overseasPlayers.map(previewPlayer)
      };
    })
  };
}

// Remaining player counts during the live auction.
function summarizeRemainingPlayers(auction) {
  if (!auction?.playerOrder) return [];

  const remaining = auction.playerOrder.slice(auction.playerIndex);

  return ROLE_CATEGORIES.map((role) => {
    const rolePlayers = remaining.filter(
      (player) => player.role === role.key
    );

    const domestic = rolePlayers.filter(
      (player) => !isOverseas(player)
    );

    const overseas = rolePlayers.filter(isOverseas);

    return {
      key: role.key,
      label: role.label,

      total: rolePlayers.length,
      domesticCount: domestic.length,
      overseasCount: overseas.length,

      domesticNames: domestic.map((player) => player.name),
      overseasNames: overseas.map((player) => player.name)
    };
  });
}

module.exports = {
  buildPoolPreview,
  summarizeRemainingPlayers,
  selectAuctionPlayerPool,
  normalizePlayerPoolSize,
  isStarPlayer,
  STAR_PLAYER_RATING
};