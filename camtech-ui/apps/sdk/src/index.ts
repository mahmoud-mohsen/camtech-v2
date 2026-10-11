// npm entry: `import { mount } from '@camtech/sdk'` renders the SDK inline (Shadow DOM) into an element.
// The embed loader (init with modal / inline / iframe modes) is exported too.
export type { MountHandle } from './mount';
export { init, mount, version, type CamtechHandle, type EmbedMode, type EmbedOptions } from './embed';
export type { CamtechCallbacks, CamtechOptions, JourneyFlow, ScanType, VisionUrls } from './config/options';
export type {
  CancelPayload, CompletePayload, DebugEvent, DocumentScanResult, ErrorPayload, FlowResult, StepEvent, StepName,
  VerificationResult,
} from './core/protocol';
