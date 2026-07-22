// Splits a country's total population growth rate into the two forces that
// make it up: net migration (converted from per-1,000 people to a percent,
// so it shares units with the growth rate) and the residual, natural
// increase (births minus deaths) — the standard demographic identity
// growth ≈ natural increase + net migration. Pure/DOM-free so it can be
// unit-tested independent of how it's charted.
export function computeGrowthDecomposition({ populationGrowth, netMigrationRate }) {
  const n = Math.min(
    populationGrowth?.length ?? 0,
    netMigrationRate?.length ?? 0,
  );
  const naturalIncrease = [];
  const migration = [];
  for (let i = 0; i < n; i++) {
    const growth = populationGrowth[i];
    const migrationRate = netMigrationRate[i];
    if (!Number.isFinite(growth) || !Number.isFinite(migrationRate)) {
      naturalIncrease.push(null);
      migration.push(null);
      continue;
    }
    const migrationPercent = migrationRate / 10;
    naturalIncrease.push(growth - migrationPercent);
    migration.push(migrationPercent);
  }
  return { naturalIncrease, migration };
}
