import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../../utils/errors.js';
import { validateRegistrationInput } from '../../utils/validation.js';
import {
  createUser,
  deleteUser,
  signInWithPassword,
  type SupabaseSession,
} from '../../services/auth.service.js';
import {
  uploadUserFile,
  deleteUserFolder,
  type UploadInput,
} from '../../services/storage.service.js';
import { insertProfile, type ProfileRow } from '../../services/profile.service.js';
import type { Database } from '../../types/supabase.generated.js';

type DocumentType = Database['public']['Enums']['document_type'];
const VALID_DOCUMENT_TYPES: readonly DocumentType[] = ['passport', 'id_card', 'driver_license'];

interface ParsedRegistration {
  email: string;
  password: string;
  full_name: string;
  document_type: DocumentType;
  document_image: UploadInput;
  selfie_image: UploadInput;
}

async function parseRegistrationBody(req: FastifyRequest): Promise<ParsedRegistration> {
  if (!req.isMultipart()) {
    throw AppError.validation('Expected multipart/form-data');
  }

  const fields: Record<string, string> = {};
  const files: Record<string, UploadInput> = {};

  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buf = await part.toBuffer();
      files[part.fieldname] = {
        buffer: buf,
        filename: part.filename,
        mimetype: part.mimetype,
      };
    } else {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }

  const required = ['email', 'password', 'full_name', 'document_type'];
  for (const k of required) {
    if (!fields[k]) throw AppError.validation(`Missing field: ${k}`);
  }
  if (!files.document_image) throw AppError.validation('Missing file: document_image');
  if (!files.selfie_image) throw AppError.validation('Missing file: selfie_image');

  const docType = fields.document_type as DocumentType;
  if (!VALID_DOCUMENT_TYPES.includes(docType)) {
    throw AppError.validation(
      `Invalid document_type. Expected one of ${VALID_DOCUMENT_TYPES.join(', ')}`,
    );
  }

  return {
    email: fields.email!,
    password: fields.password!,
    full_name: fields.full_name!,
    document_type: docType,
    document_image: files.document_image,
    selfie_image: files.selfie_image,
  };
}

interface RegisterResponse {
  user: { id: string; email: string };
  profile: Omit<ProfileRow, 'document_image_path' | 'selfie_image_path'>;
  session: SupabaseSession;
}

function publicProfile(p: ProfileRow): RegisterResponse['profile'] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { document_image_path: _doc, selfie_image_path: _selfie, ...rest } = p;
  return rest;
}

export async function registerRoute(app: FastifyInstance): Promise<void> {
  app.post('/auth/register', async (req, reply): Promise<RegisterResponse> => {
    const parsed = await parseRegistrationBody(req);
    validateRegistrationInput(parsed); // stub

    const created = await createUser(parsed.email, parsed.password);

    let documentPath: string | null = null;
    let selfiePath: string | null = null;
    let profile: ProfileRow | null = null;

    try {
      documentPath = await uploadUserFile(created.id, 'document', parsed.document_image);
      selfiePath = await uploadUserFile(created.id, 'selfie', parsed.selfie_image);

      profile = await insertProfile({
        id: created.id,
        email: parsed.email,
        full_name: parsed.full_name,
        document_type: parsed.document_type,
        document_image_path: documentPath,
        selfie_image_path: selfiePath,
      });

      const signed = await signInWithPassword(parsed.email, parsed.password);

      reply.code(201);
      return {
        user: { id: created.id, email: created.email },
        profile: publicProfile(profile),
        session: signed.session,
      };
    } catch (err) {
      // Cleanup so a partial registration leaves no orphans behind.
      req.log.warn({ userId: created.id, err }, 'registration failed; rolling back auth user');
      await deleteUserFolder(created.id).catch((cleanupErr) =>
        req.log.warn({ cleanupErr }, 'storage cleanup failed'),
      );
      await deleteUser(created.id).catch((cleanupErr) =>
        req.log.warn({ cleanupErr }, 'auth user cleanup failed'),
      );
      throw err;
    }
  });
}
