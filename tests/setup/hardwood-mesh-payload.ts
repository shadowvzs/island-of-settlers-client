import { installHardwoodMeshPayloadFromDisk } from "../../tools/assets/hardwood-mesh-payload-file";

/** The game fetches the hardwood payload in its island-asset step; tests read the same file from disk. */
installHardwoodMeshPayloadFromDisk();
