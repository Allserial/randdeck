export type DrawMode = "range" | "custom" | "expression" | "weighted";
export type ActiveDrawMode = "range" | "custom" | "expression";
export type CountMemoryMode = ActiveDrawMode;
export type AppView = "roll" | "insights" | "settings";
export type ThemeMode = "dark" | "light" | "contrast";
export type MotionLevel = "instant" | "standard" | "ceremony";
export type SoundProfile = "minimal" | "mechanical" | "dice";
export type StudioTab = "custom" | "weighted" | "tags" | "dice";
export type InsightsTab = "overview" | "history" | "probability";
export type CopyFormat = "comma" | "newline";
export type TimerExpireAction = "reveal" | "autodraw";
export type AlgorithmVersion = "webcrypto-rejection-v1" | "webcrypto-fisher-yates-v1";

export type CeremonyPhase = "idle" | "countdown" | "revealing" | "finished";

export interface CeremonyState {
  phase: CeremonyPhase;
  remainingSeconds: number;
  revealedCount: number;
  targetTransaction: DrawTransaction | null;
}

export interface TagFilter {
  selectedTags: string[];
  combine: "any" | "all";
}

export interface ExpressionSettings {
  source: string;
  evaluation: "single" | "batch";
  tagBehavior: "classify" | "constrain";
}

export interface AppearanceSettings {
  theme: ThemeMode;
  motion: MotionLevel;
  soundProfile: SoundProfile;
  particles: boolean;
}

export interface TimerSettings {
  durationSec: number;
  expireAction: TimerExpireAction;
}

export interface DesktopSettings {
  displayMode: "normal" | "fullscreen" | "overlay";
  displayClickThrough: boolean;
}

export interface DrawSettings {
  mode: DrawMode;
  min: number;
  max: number;
  customInput: string;
  count: number;
  noDup: boolean;
  excludeInput: string;
  muted: boolean;
  tagFilter: TagFilter;
  expression: ExpressionSettings;
  appearance: AppearanceSettings;
  desktop: DesktopSettings;
  timer: TimerSettings;
}

export interface PoolEntry {
  id: string;
  value: number;
  tags: string[];
}

export interface WeightedEntry extends PoolEntry {
  weight: number;
}

export interface TagRule {
  id: string;
  label: string;
  expression: string;
}

export interface PoolsState {
  customEntries: PoolEntry[];
  weightedEntries: WeightedEntry[];
  rangeTagRules: TagRule[];
  expressionTagRules: TagRule[];
}

export interface DiceFace {
  value: number;
  sides?: number;
  kept?: boolean;
  exploded?: boolean;
  rerolled?: boolean;
}

export interface DrawResult {
  value: number;
  total: number;
  faces: DiceFace[];
  tags: string[];
  trace?: unknown;
}

export interface StatsBucket {
  draws: number;
  values: Record<string, number>;
  faces: Record<string, number>;
  tags: Record<string, number>;
  resetAt: string | null;
}

export interface StatsState {
  version: 2;
  byMode: Record<DrawMode, StatsBucket>;
}

export interface StatsDelta {
  mode: DrawMode;
  draws: number;
  values: Record<string, number>;
  faces: Record<string, number>;
  tags: Record<string, number>;
}

export interface CandidateSpec {
  mode: DrawMode;
  range?: { min: number; max: number };
  entries?: Array<{ value: number; weight?: number; tags: string[] }>;
  expression?: string;
  exclusions: string;
  selectedTags: string[];
  tagCombine: "any" | "all";
}

export interface DrawPlan {
  mode: DrawMode;
  count: number;
  configSnapshot: DrawSettings;
  poolsSnapshot: PoolsState;
  poolFingerprint: string;
  sourceCount: number;
  candidateEntries: WeightedEntry[];
  candidateSpec: CandidateSpec;
  expressionAst?: DiceAstNode;
  presetId?: string | null;
  operationKind?: "draw" | "shuffle";
}

export type DrawOperation =
  | { kind: "draw" }
  | { kind: "reroll"; sourceTransactionId: string; rerolledIndices: number[] }
  | { kind: "shuffle" };

export interface ReceiptPayload {
  schema: "zhishutai.receipt.v1";
  appVersion: string;
  algorithmVersion: AlgorithmVersion;
  transactionId: string;
  createdAt: string;
  mode: DrawMode;
  config: DrawSettings;
  candidate: CandidateSpec & { count: number; digest: string };
  results: DrawResult[];
  operation: DrawOperation;
  session?: { id: string; name: string; round: number };
  presetId?: string;
  digest: string;
}

export interface DrawTransaction {
  id: string;
  createdAt: string;
  mode: DrawMode;
  configSnapshot: DrawSettings;
  poolsSnapshot: PoolsState;
  poolFingerprint: string;
  candidateCount: number;
  candidateSpec: CandidateSpec;
  results: DrawResult[];
  operation: DrawOperation;
  statsDelta: StatsDelta;
  usedAdded: number[];
  algorithmVersion: AlgorithmVersion;
  session?: { id: string; name: string; round: number };
  presetId?: string;
  receipt?: ReceiptPayload;
}

export interface HistoryEntry {
  id: string;
  transactionId?: string;
  createdAt: string | null;
  mode: DrawMode;
  config: DrawSettings;
  results: DrawResult[];
  operation?: DrawOperation;
  statsDelta?: StatsDelta;
  poolFingerprint?: string;
  usedAdded?: number[];
  receipt?: ReceiptPayload;
  sessionId?: string;
  presetId?: string;
  legacy: boolean;
}

export interface Preset {
  id: string;
  name: string;
  config: DrawSettings;
  pools: PoolsState;
}

export interface SessionTransactionRecord {
  id: string;
  createdAt: string;
  results: DrawResult[];
  operation: DrawOperation;
  statsDelta: StatsDelta;
  poolFingerprint: string;
  usedAdded: number[];
  receipt?: ReceiptPayload;
}

export interface DrawSession {
  id: string;
  name: string;
  startedAt: string;
  endedAt?: string;
  configSnapshot: DrawSettings;
  poolsSnapshot: PoolsState;
  poolFingerprint: string;
  transactionIds: string[];
  transactionRecords: SessionTransactionRecord[];
  roundCount: number;
}

export interface DrawState {
  poolFingerprint: string;
  usedValues: number[];
  lastTransactionId: string | null;
  activePresetId: string | null;
}

export interface CountByMode {
  range: number;
  custom: number;
  expression: number;
}

export interface UiState {
  activeView: AppView;
  inspectorOpen: boolean;
  insightsTab: InsightsTab;
  compareIds: string[];
  copyFormat: CopyFormat;
  countByMode: CountByMode;
}

export interface AppStateV5 {
  version: 5;
  settings: DrawSettings;
  pools: PoolsState;
  history: HistoryEntry[];
  stats: StatsState;
  presets: Preset[];
  pinnedPresetIds: string[];
  drawState: DrawState;
  activeSession: DrawSession | null;
  sessionArchive: DrawSession[];
  ui: UiState;
  migrationNotes: string[];
}

export type AppState = AppStateV5;
export type AppStateV4 = AppStateV5;
export type AppStateV3 = AppStateV5;

export type DiceAstNode =
  | { type: "number"; value: number }
  | { type: "unary"; operator: "+" | "-"; value: DiceAstNode }
  | { type: "binary"; operator: "+" | "-" | "*" | "/"; left: DiceAstNode; right: DiceAstNode }
  | {
      type: "dice";
      count: number;
      sides: number;
      modifiers: {
        explode?: boolean;
        keep?: { type: "kh" | "kl" | "dh" | "dl"; count: number };
        reroll?: { operator: "<" | ">"; threshold: number };
      };
      success?: { operator: ">=" | "<=" | ">" | "<" | "=="; threshold: number };
    };

export interface ProbabilityRequest {
  mode: DrawMode;
  count: number;
  noDup: boolean;
  candidates: WeightedEntry[];
  expression?: { source: string; ast: DiceAstNode; constrained: boolean; tagRules?: TagRule[]; selectedTags?: string[]; combine?: "any" | "all" };
}

export interface ProbabilityPoint {
  value: number;
  probability: number;
  expectedCount: number;
  observed?: number;
}

export interface ProbabilityReport {
  method: "exact" | "simulation";
  reason: string;
  generatedAt: string;
  seed?: number;
  samples?: number;
  uncertainty?: number;
  points: ProbabilityPoint[];
}
