import { createContext, useContext, useEffect, useRef } from 'react';
import type { Branding, Capabilities, CamtechPublicClient } from '@camtech/api-client';
import type { JourneyFlow, SdkConfig } from '../config/options';
import type { HostBridge } from '../core/bridge';
import type { JourneyProgress, StageKey } from '../core/journey-progress';
import type { ErrorPayload, StepName } from '../core/protocol';
import type { ProgressChannel } from '../core/transport';
import type { Translator } from '../i18n';

export type SimulateMode = 'always' | 'fallback' | 'never';

export interface CancelInfo {
  /** Selfie verification to cancel on the server, if any. */
  sessionId: string | null;
  /** Called after the user confirms (e.g. POST /cancel). Errors are ignored. */
  onCancel?: () => Promise<unknown> | void;
}

export interface SdkContextValue {
  config: SdkConfig;
  client: CamtechPublicClient;
  progress: ProgressChannel;
  caps: Capabilities | null;
  branding: Branding;
  i18n: Translator;
  bridge: HostBridge;
  /** Simulated camera: always, only when no real camera works (mock builds), or never. */
  simulate: SimulateMode;
  /** Static preview (portal branding editor): no camera, no API. */
  preview: boolean;
  /** Subject reference (option or SDK token claim). */
  subjectRef: string | null;
  setCancelInfo: (info: CancelInfo | null) => void;
  reportStep: (flow: JourneyFlow | null, step: StepName) => void;
  reportError: (e: Omit<ErrorPayload, 'flow'> & { flow?: JourneyFlow | null }) => void;
  requestCancel: () => void;
  /** Called by flows to tell the host page the selfie session (for the return URL). */
  setSessionId: (id: string | null) => void;
  /** Where the user is in the journey (null: nothing to show). */
  journey: JourneyProgress | null;
  /** Every stage of the journey, in order (empty in the preview). */
  stages: readonly StageKey[];
  /** Camera screens take the whole SDK area: the header and footer step aside. */
  setImmersive: (on: boolean) => void;
}

export const SdkContext = createContext<SdkContextValue | null>(null);

export function useSdk(): SdkContextValue {
  const ctx = useContext(SdkContext);
  if (!ctx) throw new Error('useSdk must be used inside the camtech SDK');
  return ctx;
}

export function useT(): Translator {
  return useSdk().i18n;
}

/** Full-screen camera while the calling screen is shown. */
export function useImmersive(on = true): void {
  const setImmersive = useContext(SdkContext)?.setImmersive;
  useEffect(() => {
    if (!on || !setImmersive) return;
    setImmersive(true);
    return () => setImmersive(false);
  }, [on, setImmersive]);
}

/** Reports the current screen once per change. */
export function useStep(flow: JourneyFlow | null, step: StepName): void {
  const { reportStep } = useSdk();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const key = `${flow}:${step}`;
    if (last.current === key) return;
    last.current = key;
    reportStep(flow, step);
  }, [flow, step, reportStep]);
}
