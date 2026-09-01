import { BadRequestException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';

@Injectable()
export class FileSecurityService {
    constructor(
        private readonly configService: ConfigService,
    ) {}

    private decryptEncryptedExportFile(encryptedBuffer: Buffer): Buffer {
        const keyBase64 = this.configService.get<string>('OBDC_ENCRYPTION_KEY');
        console.log(keyBase64);

        if (!keyBase64) {
            throw new BadRequestException(
                'Missing OBDC_ENCRYPTION_KEY environment variable',
            );
        }

        const key = Buffer.from(keyBase64, 'base64');

        if (key.length !== 32) {
        throw new BadRequestException(
            'OBDC_ENCRYPTION_KEY must decode to 32 bytes',
        );
        }

        if (encryptedBuffer.length <= 28) {
            throw new BadRequestException('Invalid encrypted file');
        }

        const nonce = encryptedBuffer.subarray(0, 12);
        const encryptedData = encryptedBuffer.subarray(12);

        const ciphertext = encryptedData.subarray(0, encryptedData.length - 16);
        const authTag = encryptedData.subarray(encryptedData.length - 16);

        try {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
            decipher.setAuthTag(authTag);

        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch {
            throw new BadRequestException(
                'Unable to decrypt file. The file may be invalid, modified, or encrypted with the wrong key.',
            );
        }
    }

    extractAndVerifySignedExcel(file: Express.Multer.File): Buffer {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }

        if (!file.originalname.toLowerCase().endsWith('.enc')) {
            throw new BadRequestException(
            'Please upload the encrypted .enc file from LBDC',
        );
        }

        const decryptedZipBuffer = this.decryptEncryptedExportFile(file.buffer);

        const zip: AdmZip = new AdmZip(decryptedZipBuffer);

        const excelEntry = zip.getEntry('attendance_export.xlsx');

        const signatureEntry = zip.getEntry('attendance_export.xlsx.sig');

        if (!excelEntry || !signatureEntry) {
            throw new BadRequestException(
                'Invalid ZIP. It must contain attendance_export.xlsx and attendance_export.xlsx.sig',
            );
        }

        const excelBuffer = excelEntry.getData();

        const signatureBase64 = signatureEntry.getData().toString('utf8').trim();

        const isValid = this.verifyLbdcSignature(excelBuffer, signatureBase64);

        if (!isValid) {
            throw new BadRequestException(
                'Invalid file signature. The Excel file may have been modified.',
            );
        }

        return excelBuffer;
    }

    private verifyLbdcSignature(
        excelBuffer: Buffer,
        signatureBase64: string,
    ): boolean {
        const publicKeyPath = path.join(
        process.cwd(),
        'keys',
        'lbdc_public_key.pem',
        );

        if (!fs.existsSync(publicKeyPath)) {
            throw new BadRequestException(
                `LBDC public key not found at ${publicKeyPath}`,
            );
        }

        const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
        const signature = Buffer.from(signatureBase64, 'base64');

        return crypto.verify(
            'sha256',
            excelBuffer,
            {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
                saltLength: crypto.constants.RSA_PSS_SALTLEN_MAX_SIGN,
            },
            signature,
        );
    }
}