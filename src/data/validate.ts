// Schema validation for the data contracts. Pure (no `three`); used by tests and tooling.
import { Ajv, type ErrorObject } from 'ajv'
import commonSchema from './schemas/common.schema.json'
import confidenceSchema from './schemas/confidence.schema.json'
import dimensionsSchema from './schemas/dimensions.schema.json'
import paletteSchema from './schemas/palette.schema.json'
import sourcesSchema from './schemas/sources.schema.json'
import pedimentsSchema from './schemas/pediments.schema.json'
import deviationsSchema from './schemas/approved-deviations.schema.json'
import sculpturesSchema from './schemas/sculptures.schema.json'
import sanctuarySchema from './schemas/sanctuary.schema.json'

export type ContractName = 'dimensions' | 'palette' | 'sources' | 'pediments' | 'approved-deviations' | 'sculptures' | 'sanctuary'

const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false })
ajv.addSchema([commonSchema, confidenceSchema])
const validators = {
  dimensions: ajv.compile(dimensionsSchema),
  palette: ajv.compile(paletteSchema),
  sources: ajv.compile(sourcesSchema),
  pediments: ajv.compile(pedimentsSchema),
  'approved-deviations': ajv.compile(deviationsSchema),
  sculptures: ajv.compile(sculpturesSchema),
  sanctuary: ajv.compile(sanctuarySchema),
} satisfies Record<ContractName, unknown>

/** Validates `data` against the named contract. Returns [] when valid. */
export function validate(name: ContractName, data: unknown): ErrorObject[] {
  const fn = validators[name]
  return fn(data) ? [] : [...(fn.errors ?? [])]
}
