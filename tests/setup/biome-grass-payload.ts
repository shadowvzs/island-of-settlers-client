import {
  installBiomeGrassHeroPayloadFromDisk,
  installBiomeGrassPayloadFromDisk
} from "../../tools/assets/biome-grass-payload-file";

// The biome grass prop meshes are generated from lazy binary payloads at runtime; tests read them from disk.
installBiomeGrassPayloadFromDisk();
installBiomeGrassHeroPayloadFromDisk();
