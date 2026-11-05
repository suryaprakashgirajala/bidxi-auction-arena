const ROLE_CATEGORIES = [
  { key: "Batter", label: "Batters" },
  { key: "Bowler", label: "Bowlers" },
  { key: "Wicket Keeper", label: "Wicketkeepers" },
  { key: "All Rounder", label: "All-rounders" }
];

function isOverseas(player) {
  const nationality = String(player?.nationality || "").trim().toLowerCase();
  return Boolean(nationality && nationality !== "india" && nationality !== "indian");
}

function previewImage(player) {
  const image = typeof player?.image === "string" ? player.image : "";
  return image && image.length <= 40000 ? image : null;
}

function buildPoolPreview(players = []) {
  return {
    totalPlayers: players.length,
    categories: ROLE_CATEGORIES.map((role) => {
      const categoryPlayers = players.filter((player) => player.role === role.key);
      const domesticPlayers = categoryPlayers.filter((player) => !isOverseas(player));
      const overseasPlayers = categoryPlayers.filter(isOverseas);
      return {
        key: role.key,
        label: role.label,
        total: categoryPlayers.length,
        domesticCount: domesticPlayers.length,
        overseasCount: overseasPlayers.length,
        domesticPlayers: domesticPlayers.map((player) => ({ id: player.id, name: player.name, nationality: player.nationality, basePrice: player.basePrice, image: previewImage(player), arenaRating: player.arenaRating })),
        overseasPlayers: overseasPlayers.map((player) => ({ id: player.id, name: player.name, nationality: player.nationality, basePrice: player.basePrice, image: previewImage(player), arenaRating: player.arenaRating }))
      };
    })
  };
}

function summarizeRemainingPlayers(auction) {
  if (!auction?.playerOrder) return [];
  const remaining = auction.playerOrder.slice(auction.playerIndex);
  return ROLE_CATEGORIES.map((role) => {
    const rolePlayers = remaining.filter((player) => player.role === role.key);
    const domestic = rolePlayers.filter((player) => !isOverseas(player));
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

module.exports = { buildPoolPreview, summarizeRemainingPlayers };
