/// <reference types="vite/client" />
declare module 'sql.js' {
  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }
  export interface Statement {
    step(): boolean;
    getAsObject<T = any>(): T;
    free(): void;
  }
  export interface Database {
    prepare(sql: string): Statement;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => Database;
  }
  const initSqlJs: (config?: SqlJsConfig) => Promise<SqlJsStatic>;
  export default initSqlJs;
  export { Database, SqlJsStatic };
}
