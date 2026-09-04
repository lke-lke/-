export type DataMode = 'mock' | 'supabase' | 'oneday';

const configuredMode = process.env.APP_DATA_MODE as DataMode | undefined;

export const DATA_MODE: DataMode = configuredMode === 'supabase' || configuredMode === 'oneday'
  ? configuredMode
  : 'mock';

export const USE_MOCK = DATA_MODE === 'mock';
