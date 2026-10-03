/**
 * Side-effect module: must be the FIRST import of index.ts.
 * ESM evaluates imports before the importing module's body, so env defaults
 * (.env + cloud data paths) have to be applied here, before any repository
 * singleton resolves its data path at import time.
 */
import { loadDotEnv } from './loadEnv.js'

loadDotEnv()
