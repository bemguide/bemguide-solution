import FormData from 'form-data';

export interface MultipartFile {
  field: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export function buildMultipart(
  fields: Record<string, string>,
  files: MultipartFile[] = [],
): { payload: Buffer; headers: Record<string, string> } {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const f of files) {
    form.append(f.field, f.buffer, { filename: f.filename, contentType: f.contentType });
  }
  return { payload: form.getBuffer(), headers: form.getHeaders() };
}

export function fakePng(label = 'test'): Buffer {
  // Minimal 1x1 PNG (valid magic bytes), with a label appended in a tEXt chunk-ish suffix
  // so different test files don't dedupe. Mime sniffing isn't enforced yet (stub validator).
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63606060000000040001271fb900000000049454e44ae426082',
    'hex',
  );
  return Buffer.concat([png, Buffer.from(`__${label}__`)]);
}
