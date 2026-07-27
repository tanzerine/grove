'use client';
import { useEffect, useRef } from 'react';
import { captureClient } from '@/lib/analytics/capture-client';
import { onboardingStepNumber, type OnboardingStep } from '@/lib/analytics/events';

/**
 * Records that one onboarding step was reached. Drop it in a step page and the
 * funnel builds itself — `onboarding_step_viewed` broken down by `step_number`
 * is the drop-off chart, which is the number that decides whether a public
 * launch is converting or leaking.
 *
 * Rendered as a null component rather than a hook so the step pages stay
 * declarative and nothing has to be threaded through their existing effects.
 */
export default function StepView({ step }: { step: OnboardingStep }) {
  // React 18/19 run effects twice in dev StrictMode, and these pages re-render
  // on every keystroke of their forms. Without this guard the funnel's first
  // stage would be inflated relative to later ones and every rate would be wrong.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    captureClient('onboarding_step_viewed', { step, step_number: onboardingStepNumber(step) });
  }, [step]);

  return null;
}
