import type { Command } from './types.js'
import { exitCommand } from './exit.js'
import { helpCommand } from './help.js'
import { modelCommand } from './model.js'
import { lintCommand } from './lint.js'
import { pruneCommand } from './prune.js'
import { urlCommand } from './url.js'
import { importCommand } from './import.js'
import { forceIngestCommand, ingestCommand } from './ingest.js'
import { retryCommand } from './retry.js'
import { continueCommand } from './continue.js'
import { learnCommand } from './learn.js'
import { reindexCommand } from './reindex.js'

export const commands: Command[] = [
  exitCommand,
  helpCommand,
  modelCommand,
  lintCommand,
  pruneCommand,
  urlCommand,
  importCommand,
  forceIngestCommand,
  ingestCommand,
  retryCommand,
  continueCommand,
  learnCommand,
  reindexCommand,
]

export type { Command, CommandContext } from './types.js'
