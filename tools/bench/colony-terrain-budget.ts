import { colonyWorldOptions } from "../../src/shared/world/generation/colony-world";
import { generateWorld } from "../../src/shared/world/generation/generate-world";
import { BUILD, ORE } from "../../src/shared/world/world-data";
const seeds = [1234, 303007057, 3279752914, 3903080913];
for (const compact of [false, true]) {
  const rows = seeds.map(seed => {
    const world = generateWorld({ ...colonyWorldOptions(seed), ...(compact ? {} : { mountainScale: 1, mineApronScale: 1, minimumDepositMines: 3, mountainProfiles: true }) });
    return { seed, peak: Math.max(...world.heights), buildable: world.buildClass.filter(v=>v>=BUILD.small).length,
      mountain: world.heights.filter(v=>v>4).length,
      mine: world.mineZone.filter(id=>id>0).length, ore:world.oreAmount.filter(v=>v>0).length,
      deposits:world.mineZones.filter(z=>z.ore!==ORE.none).length };
  });
  console.log(JSON.stringify({compact,rows}));
}
