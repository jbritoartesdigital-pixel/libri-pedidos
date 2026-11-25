import {ATELIE_V41_APPROVED_CATALOG} from './v3-atelie-v41-commercial-catalog.js';
import {buildAtelieBriefingBlueprint as buildShared} from '../../public/js/briefing-schema-atelie.v119.js';
export function buildAtelieBriefingBlueprint(input={}){return buildShared({...input,includedPosesOverride:ATELIE_V41_APPROVED_CATALOG[input.packageCode]?.mascotPoses});}
