import { createContext, useContext } from 'react';
import type { RunPlan } from '../domain/plans';

export type ParentSection =
  | 'hub'
  | 'settings'
  | 'room'
  | 'backup'
  | 'content'
  | 'notes'
  | 'drills'
  | 'sessions'
  | 'priorities'
  | 'advancement'
  | 'transfer'
  | 'history'
  | 'trials'
  | 'demos'
  | 'placement'
  | 'export'
  | 'cues'
  | 'camera'
  | 'clips'
  | 'posetest'
  | 'defender'
  | 'timing'
  | 'validation'
  | 'balls'
  | 'learning'
  | 'results';

export type Route =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'run'; plan: RunPlan; trial: boolean; trialReasons: string[] }
  | { name: 'summary'; runId: string }
  | { name: 'progress'; tab: 'week' | 'skills' | 'drills' | 'review' }
  | { name: 'drill'; key: string }
  | { name: 'builder' }
  | { name: 'start'; plan: RunPlan }
  | { name: 'baselineQuestions'; recordId: string }
  | { name: 'parent'; section: ParentSection; arg?: string };

export interface Nav {
  route: Route;
  go: (r: Route) => void;
  parentUnlocked: boolean;
  setParentUnlocked: (v: boolean) => void;
}

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error('useNav outside NavCtx');
  return n;
}
