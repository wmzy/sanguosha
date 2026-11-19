// src/client/utils/jsonFile.ts — JSON 文件下载/读取样板收口

/** readJsonFile 结构校验失败的标记错误;调用方 catch 后可替换为面向用户的文案 */
export class JsonValidationError extends Error {
  constructor() {
    super('Invalid JSON structure');
    this.name = 'JsonValidationError';
  }
}

/** 序列化为 JSON 并触发浏览器下载;pretty 为 true 时 2 空格缩进 */
export function downloadJson(filename: string, data: unknown, pretty?: boolean): void {
  const json = JSON.stringify(data, null, pretty ? 2 : undefined);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 读取 File 并 JSON.parse;提供 validate 时校验结构,失败 reject JsonValidationError */
export function readJsonFile<T>(file: File, validate?: (v: unknown) => v is T): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data: unknown = JSON.parse(reader.result as string);
      if (validate && !validate(data)) {
        reject(new JsonValidationError());
        return;
      }
      resolve(data as T);
    } catch (e) {
      reject(e);
    }
  };
  reader.onerror = reject;
  reader.readAsText(file);
  return promise;
}
