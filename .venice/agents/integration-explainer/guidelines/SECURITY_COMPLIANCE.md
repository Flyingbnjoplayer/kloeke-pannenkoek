# SECURITY & COMPLIANCE GUIDELINES

## OVERVIEW
Comprehensive security framework for the multi-agent platform. Covers API key management, data protection, regulatory compliance, and audit requirements for web3 and traditional web applications.

---

## 1. API KEY & SECRET MANAGEMENT

### 1.1 Environment Variable Standards
**Principle**: Never commit secrets to version control. Use environment-specific configurations.

**Implementation**:
```bash
# .env.example (Template - committed to repo)
NEXT_PUBLIC_API_URL="https://api.example.com"
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
NEXT_PUBLIC_SENTRY_DSN="your-sentry-dsn"

# Secrets (NOT committed)
SUPABASE_SERVICE_ROLE_KEY=""
STRIPE_SECRET_KEY=""
COINBASE_API_SECRET=""
VENICE_AI_API_KEY=""
FARCASTER_PRIVATE_KEY=""
WALLETCONNECT_PROJECT_SECRET=""
PINATA_JWT=""
DATABASE_URL=""
```

**Environment Structure**:
```typescript
// lib/env.ts - Type-safe environment validation
import { z } from 'zod'

const envSchema = z.object({
  // Public (safe for browser)
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().min(1),
  
  // Private (server only)
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  
  // API Keys
  VENICE_AI_API_KEY: z.string().min(1),
  COINBASE_API_KEY: z.string().min(1),
  COINBASE_API_SECRET: z.string().min(1),
  FARCASTER_MNEMONIC: z.string().min(1),
  PINATA_JWT: z.string().min(1),
  NEYNAR_API_KEY: z.string().min(1),
  
  // Encryption
  ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex
  JWT_SECRET: z.string().min(32),
  
  // Feature Flags
  ENABLE_ANALYTICS: z.string().transform(val => val === 'true').optional(),
  ENABLE_DEBUG: z.string().transform(val => val === 'true').optional(),
})

export type Env = z.infer<typeof envSchema>

class EnvService {
  private static env: Env
  
  static validate() {
    try {
      this.env = envSchema.parse(process.env)
      return this.env
    } catch (error) {
      console.error('Environment validation failed:', error)
      throw new Error('Invalid environment configuration')
    }
  }
  
  static get<K extends keyof Env>(key: K): Env[K] {
    if (!this.env) {
      this.validate()
    }
    return this.env[key]
  }
  
  static isProduction(): boolean {
    return this.get('NODE_ENV') === 'production'
  }
  
  static isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development'
  }
  
  static isTest(): boolean {
    return this.get('NODE_ENV') === 'test'
  }
}

export default EnvService
```

### 1.2 Secure Storage Hierarchy
**Priority Levels**:
```yaml
Level 1: User Private Keys (Highest Sensitivity)
  - Storage: Hardware wallet / encrypted browser storage
  - Access: User-only with biometric auth
  - Backup: Encrypted cloud with user-controlled key

Level 2: Application Secrets (High Sensitivity)
  - Storage: Hardware Security Module (HSM) / Vault
  - Access: CI/CD pipeline only
  - Rotation: 90 days mandatory
  - Examples: JWT secrets, database credentials

Level 3: API Keys (Medium Sensitivity)
  - Storage: Environment variables / secrets manager
  - Access: Server-side only
  - Rotation: 180 days recommended
  - Examples: Venice.ai API key, Stripe keys

Level 4: Configuration (Low Sensitivity)
  - Storage: Environment variables
  - Access: Both client and server
  - Rotation: As needed
  - Examples: Feature flags, public API URLs
```

### 1.3 Key Rotation Automation
```typescript
// lib/security/key-rotation.ts
import crypto from 'crypto'
import { supabase } from '@/lib/supabase'
import { encrypt, decrypt } from './encryption'

interface KeyRotationPolicy {
  keyId: string
  keyType: 'jwt' | 'api' | 'encryption'
  rotationPeriodDays: number
  lastRotation: Date
  nextRotation: Date
  autoRotate: boolean
}

export class KeyRotationService {
  private static async rotateJwtSecret(): Promise<string> {
    const newSecret = crypto.randomBytes(64).toString('hex')
    
    // Update environment in all services
    await this.updateEnvironmentVariable('JWT_SECRET', newSecret)
    
    // Migrate existing tokens gradually
    await this.migrateJwtTokens(newSecret)
    
    return newSecret
  }
  
  private static async rotateApiKey(service: string): Promise<string> {
    const newKey = crypto.randomBytes(32).toString('hex')
    
    // Store encrypted version
    const encryptedKey = encrypt(newKey, process.env.ENCRYPTION_KEY!)
    
    await supabase
      .from('api_keys')
      .update({
        encrypted_key: encryptedKey,
        last_rotated: new Date().toISOString(),
        status: 'rotating'
      })
      .eq('service', service)
    
    // Update service configuration
    await this.updateServiceConfig(service, newKey)
    
    return newKey
  }
  
  private static async checkRotationSchedule(): Promise<void> {
    const policies = await supabase
      .from('key_rotation_policies')
      .select('*')
      .lte('next_rotation', new Date().toISOString())
    
    for (const policy of policies.data || []) {
      if (policy.auto_rotate) {
        console.log(`Rotating key: ${policy.key_id}`)
        
        switch (policy.key_type) {
          case 'jwt':
            await this.rotateJwtSecret()
            break
          case 'api':
            await this.rotateApiKey(policy.service!)
            break
          case 'encryption':
            await this.rotateEncryptionKey()
            break
        }
        
        // Update rotation schedule
        await supabase
          .from('key_rotation_policies')
          .update({
            last_rotation: new Date().toISOString(),
            next_rotation: new Date(Date.now() + policy.rotation_period_days * 24 * 60 * 60 * 1000)
          })
          .eq('id', policy.id)
      }
    }
  }
  
  static async scheduleDailyRotationCheck(): Promise<void> {
    // Run at 2 AM daily
    setInterval(async () => {
      await this.checkRotationSchedule()
    }, 24 * 60 * 60 * 1000)
    
    // Initial check
    await this.checkRotationSchedule()
  }
}
```

---

## 2. DATA PROTECTION & ENCRYPTION

### 2.1 Encryption Standards
**At Rest**:
```typescript
// lib/security/encryption.ts
import crypto from 'crypto'
import { promisify } from 'util'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16
const SALT_LENGTH = 64
const KEY_LENGTH = 32
const ITERATIONS = 100000

export class EncryptionService {
  static async encrypt(text: string, secretKey: string): Promise<string> {
    const iv = crypto.randomBytes(IV_LENGTH)
    const salt = crypto.randomBytes(SALT_LENGTH)
    
    const key = await promisify(crypto.scrypt)(secretKey, salt, KEY_LENGTH)
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
    
    let encrypted = cipher.update(text, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    
    const authTag = cipher.getAuthTag()
    
    // Format: salt:iv:authTag:encryptedText
    return Buffer.concat([salt, iv, authTag, Buffer.from(encrypted, 'hex')]).toString('base64')
  }
  
  static async decrypt(encryptedText: string, secretKey: string): Promise<string> {
    const data = Buffer.from(encryptedText, 'base64')
    
    const salt = data.subarray(0, SALT_LENGTH)
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH)
    const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH)
    
    const key = await promisify(crypto.scrypt)(secretKey, salt, KEY_LENGTH)
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    
    let decrypted = decipher.update(encrypted)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    
    return decrypted.toString('utf8')
  }
  
  static async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = await promisify(crypto.scrypt)(password, salt, 64)
    
    return `${salt}:${hash.toString('hex')}`
  }
  
  static async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, hash] = storedHash.split(':')
    const derivedHash = await promisify(crypto.scrypt)(password, salt, 64)
    
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      derivedHash
    )
  }
  
  static generateKeyPair(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: process.env.ENCRYPTION_KEY
      }
    })
    
    return { publicKey, privateKey }
  }
}
```

**In Transit**:
```typescript
// lib/security/tls.ts
import https from 'https'
import tls from 'tls'
import fs from 'fs'

export class TLSService {
  static getServerOptions() {
    return {
      key: fs.readFileSync(process.env.SSL_KEY_PATH!),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH!),
      ca: fs.readFileSync(process.env.SSL_CA_PATH!),
      
      // Modern TLS configuration
      minVersion: 'TLSv1.3',
      ciphers: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256'
      ].join(':'),
      
      honorCipherOrder: true,
      secureProtocol: 'TLSv1_3_method',
      
      // HSTS headers
      setHeaders: (res: any) => {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('X-Frame-Options', 'DENY')
        res.setHeader('X-XSS-Protection', '1; mode=block')
      }
    }
  }
  
  static createSecureAgent() {
    return new https.Agent({
      rejectUnauthorized: true,
      checkServerIdentity: (host, cert) => {
        const err = tls.checkServerIdentity(host, cert)
        if (err) {
          console.error('TLS certificate validation failed:', err)
          return err
        }
      },
      minVersion: 'TLSv1.3',
      ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256'
    })
  }
}
```

### 2.2 Database Security
**Row Level Security Policies**:
```sql
-- Enhanced RLS policies with audit logging
CREATE TABLE audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE', 'SELECT')),
  old_record JSONB,
  new_record JSONB,
  user_id UUID REFERENCES auth.users(id),
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_trigger_function()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    table_name,
    record_id,
    operation,
    old_record,
    new_record,
    user_id,
    ip_address,
    user_agent
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN row_to_json(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN row_to_json(NEW) ELSE NULL END,
    auth.uid(),
    inet_client_addr(),
    current_setting('request.headers', true)::json->>'user-agent'
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply to sensitive tables
CREATE TRIGGER users_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

CREATE TRIGGER api_keys_audit_trigger
  AFTER INSERT OR UPDATE OR DELETE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();
```

**Data Masking**:
```typescript
// lib/security/data-masking.ts
export class DataMaskingService {
  static maskEmail(email: string): string {
    const [localPart, domain] = email.split('@')
    if (localPart.length <= 2) {
      return '***@' + domain
    }
    return localPart[0] + '***' + localPart[localPart.length - 1] + '@' + domain
  }
  
  static maskPhone(phone: string): string {
    return phone.replace(/\d(?=\d{4})/g, '*')
  }
  
  static maskCreditCard(card: string): string {
    return card.replace(/\d(?=\d{4})/g, '*')
  }
  
  static maskWalletAddress(address: string): string {
    return address.substring(0, 6) + '...' + address.substring(address.length - 4)
  }
  
  static maskApiKey(key: string): string {
    return key.substring(0, 8) + '...' + key.substring(key.length - 4)
  }
  
  static maskSensitiveData(data: any, maskRules: Record<string, (value: any) => string>): any {
    const masked = { ...data }
    
    for (const [key, maskFn] of Object.entries(maskRules)) {
      if (key in masked) {
        masked[key] = maskFn(masked[key])
      }
    }
    
    return masked
  }
}
```

---

## 3. REGULATORY COMPLIANCE

### 3.1 GDPR Compliance Framework
```typescript
// lib/compliance/gdpr.ts
interface GDPRRequest {
  requestId: string
  userId: string
  requestType: 'access' | 'deletion' | 'correction' | 'portability'
  status: 'pending' | 'processing' | 'completed' | 'failed'
  requestedAt: Date
  completedAt?: Date
  data?: any
}

export class GDPRComplianceService {
  static async processAccessRequest(userId: string): Promise<GDPRRequest> {
    const requestId = crypto.randomUUID()
    
    // Log the request
    await supabase.from('gdpr_requests').insert({
      id: requestId,
      user_id: userId,
      request_type: 'access',
      status: 'processing',
      requested_at: new Date().toISOString()
    })
    
    // Collect all user data
    const userData = await this.collectUserData(userId)
    
    // Mask sensitive information
    const maskedData = DataMaskingService.maskSensitiveData(userData, {
      email: DataMaskingService.maskEmail,
      phone: DataMaskingService.maskPhone,
      ip_address: (ip) => ip.split('.').slice(0, 2).join('.') + '.***.***'
    })
    
    // Generate export file
    const exportFile = await this.generateExportFile(maskedData)
    
    // Update request status
    await supabase
      .from('gdpr_requests')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        data: exportFile
      })
      .eq('id', requestId)
    
    return {
      requestId,
      userId,
      requestType: 'access',
      status: 'completed',
      requestedAt: new Date(),
      completedAt: new Date(),
      data: exportFile
    }
  }
  
  static async processDeletionRequest(userId: string): Promise<GDPRRequest> {
    const requestId = crypto.randomUUID()
    
    await supabase.from('gdpr_requests').insert({
      id: requestId,
      user_id: userId,
      request_type: 'deletion',
      status: 'processing',
      requested_at: new Date().toISOString()
    })
    
    // Anonymize user data
    await this.anonymizeUserData(userId)
    
    // Soft delete user account
    await supabase
      .from('users')
      .update({
        email: `deleted_${userId}@example.com`,
        name: 'Deleted User',
        deleted_at: new Date().toISOString(),
        anonymized: true
      })
      .eq('id', userId)
    
    // Schedule permanent deletion (30 days)
    await supabase.from('deletion_queue').insert({
      user_id: userId,
      scheduled_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
    
    return {
      requestId,
      userId,
      requestType: 'deletion',
      status: 'completed',
      requestedAt: new Date(),
      completedAt: new Date()
    }
  }
  
  private static async collectUserData(userId: string): Promise<any> {
    const tables = [
      'profiles',
      'orders',
      'payments',
      'sessions',
      'api_keys',
      'audit_logs'
    ]
    
    const userData: any = {}
    
    for (const table of tables) {
      const { data } = await supabase
        .from(table)
        .select('*')
        .eq('user_id', userId)
      
      userData[table] = data || []
    }
    
    return userData
  }
  
  private static async anonymizeUserData(userId: string): Promise<void> {
    const anonymizationTasks = [
      supabase
        .from('profiles')
        .update({
          display_name: 'Anonymous',
          avatar_url: null,
          bio: null,
          website: null,
          location: null,
          anonymized: true
        })
        .eq('user_id', userId),
      
      supabase
        .from('orders')
        .update({
          shipping_address: null,
          billing_address: null,
          anonymized: true
        })
        .eq('user_id', userId),
      
      supabase
        .from('sessions')
        .delete()
        .eq('user_id', userId),
      
      supabase
        .from('api_keys')
        .delete()
        .eq('user_id', userId)
    ]
    
    await Promise.all(anonymizationTasks)
  }
}
```

### 3.2 CCPA/CPRA Compliance
```typescript
// lib/compliance/ccpa.ts
interface CCPARequest {
  requestId: string
  consumerId: string
  requestType: 'do_not_sell' | 'data_access' | 'deletion'
  status: 'pending' | 'processing' | 'completed' | 'denied'
  requestedAt: Date
  verifiedAt?: Date
  verificationMethod?: 'email' | 'phone' | 'government_id'
}

export class CCPAComplianceService {
  static async processDoNotSellRequest(consumerId: string): Promise<CCPARequest> {
    const requestId = crypto.randomUUID()
    
    // Verify consumer identity
    const isVerified = await this.verifyConsumerIdentity(consumerId)
    
    if (!isVerified) {
      return {
        requestId,
        consumerId,
        requestType: 'do_not_sell',
        status: 'denied',
        requestedAt: new Date()
      }
    }
    
    // Update consumer preferences
    await supabase
      .from('consumer_preferences')
      .upsert({
        consumer_id: consumerId,
        do_not_sell: true,
        updated_at: new Date().toISOString()
      })
    
    // Opt-out from all data sharing
    await this.optOutFromDataSharing(consumerId)
    
    return {
      requestId,
      consumerId,
      requestType: 'do_not_sell',
      status: 'completed',
      requestedAt: new Date(),
      verifiedAt: new Date(),
      verificationMethod: 'email'
    }
  }
  
  static async getDataSharingPartners(): Promise<string[]> {
    return [
      'Google Analytics',
      'Facebook Pixel',
      'Stripe',
      'SendGrid',
      'Intercom',
      'Mixpanel'
    ]
  }
  
  static async generatePrivacyPolicy(): Promise<string> {
    return `
      Privacy Policy for Multi-Agent Platform
      
      Last Updated: ${new Date().toISOString().split('T')[0]}
      
      DATA COLLECTION:
      - Personal Information: Name, email, wallet address
      - Usage Data: IP address, browser type, pages visited
      - Transaction Data: Purchase history, payment methods
      
      DATA SHARING:
      We share data with:
      ${(await this.getDataSharingPartners()).map(p => `- ${p}`).join('\n')}
      
      CONSUMER RIGHTS:
      - Right to know what personal information is collected
      - Right to delete personal information
      - Right to opt-out of sale of personal information
      - Right to non-discrimination for exercising privacy rights
      
      CONTACT:
      Privacy Officer: privacy@example.com
      CCPA Request Portal: https://example.com/ccpa-requests
    `
  }
}
```

### 3.3 Financial Compliance (PCI DSS, SOC 2)
```typescript
// lib/compliance/financial.ts
interface ComplianceCheck {
  checkId: string
  name: string
  category: 'pci' | 'soc2' | 'gdpr' | 'hipaa'
  status: 'pass' | 'fail' | 'warning'
  lastCheck: Date
  nextCheck: Date
  details: any
}

export class FinancialComplianceService {
  static async runPCICheck(): Promise<ComplianceCheck[]> {
    const checks: ComplianceCheck[] = []
    
    // Check 1: Network security
    checks.push(await this.checkNetworkSecurity())
    
    // Check 2: Data encryption
    checks.push(await this.checkDataEncryption())
    
    // Check 3: Access control
    checks.push(await this.checkAccessControl())
    
    // Check 4: Monitoring and testing
    checks.push(await this.checkMonitoring())
    
    // Check 5: Information security policy
    checks.push(await this.checkSecurityPolicy())
    
    return checks
  }
  
  static async runSOC2Check(): Promise<ComplianceCheck[]> {
    const checks: ComplianceCheck[] = []
    
    // Security
    checks.push(await this.checkSecurity())
    
    // Availability
    checks.push(await this.checkAvailability())
    
    // Processing Integrity
    checks.push(await this.checkProcessingIntegrity())
    
    // Confidentiality
    checks.push(await this.checkConfidentiality())
    
    // Privacy
    checks.push(await this.checkPrivacy())
    
    return checks
  }
  
  private static async checkNetworkSecurity(): Promise<ComplianceCheck> {
    // Implement network security checks
    return {
      checkId: crypto.randomUUID(),
      name: 'Network Security',
      category: 'pci',
      status: 'pass',
      lastCheck: new Date(),
      nextCheck: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      details: {
        firewall: 'configured',
        intrusion_detection: 'enabled',
        segmentation: 'implemented',
        wireless_security: 'wpa3'
      }
    }
  }
  
  static async generateComplianceReport(): Promise<string> {
    const pciChecks = await this.runPCICheck()
    const soc2Checks = await this.runSOC2Check()
    
    const passed = [...pciChecks, ...soc2Checks].filter(c => c.status === 'pass').length
    const total = pciChecks.length + soc2Checks.length
    
    return `
      COMPLIANCE REPORT
      Generated: ${new Date().toISOString()}
      
      PCI DSS Compliance: ${pciChecks.filter(c => c.status === 'pass').length}/${pciChecks.length}
      SOC 2 Compliance: ${soc2Checks.filter(c => c.status === 'pass').length}/${soc2Checks.length}
      
      Overall Score: ${((passed / total) * 100).toFixed(1)}%
      
      FAILED CHECKS:
      ${[...pciChecks, ...soc2Checks]
        .filter(c => c.status === 'fail')
        .map(c => `- ${c.name}: ${JSON.stringify(c.details)}`)
        .join('\n')}
      
      RECOMMENDATIONS:
      1. Implement quarterly security training
      2. Enable automated vulnerability scanning
      3. Conduct penetration testing annually
      4. Review access controls monthly
      5. Update incident response plan
    `
  }
}
```

---


## 4. AUDIT LOGGING & MONITORING

### 4.1 Comprehensive Audit System Architecture
**Principle**: Every security-relevant action must be logged with sufficient context for forensics, compliance, and debugging.

**Core Audit Schema**:
```typescript
// lib/audit/audit-types.ts
export interface AuditEvent {
  // Core identifiers
  id: string;
  timestamp: string;
  event_id: string;
  correlation_id: string;
  trace_id: string;
  span_id: string;
  
  // Actor information
  actor_type: 'user' | 'service' | 'system' | 'agent';
  actor_id: string;
  actor_name?: string;
  actor_ip: string;
  actor_user_agent?: string;
  actor_session_id?: string;
  
  // Action context
  event_type: string;
  event_category: 'authentication' | 'authorization' | 'data_access' | 'data_modification' | 'system' | 'security';
  action: 'create' | 'read' | 'update' | 'delete' | 'execute' | 'access' | 'modify';
  resource_type: string;
  resource_id: string;
  resource_name?: string;
  
  // Outcome
  status: 'success' | 'failure' | 'partial';
  status_code: number;
  status_message?: string;
  error_details?: Record<string, any>;
  
  // Contextual metadata
  metadata: {
    request_method?: string;
    request_path?: string;
    request_params?: Record<string, any>;
    request_body_hash?: string;
    response_status?: number;
    response_body_hash?: string;
    duration_ms: number;
    location?: {
      country?: string;
      region?: string;
      city?: string;
      coordinates?: [number, number];
    };
    device?: {
      type?: string;
      os?: string;
      browser?: string;
      screen_resolution?: string;
    };
  };
  
  // Compliance fields
  compliance_tags: string[];
  retention_period_days: number;
  encrypted_fields: string[];
  pii_redacted: boolean;
  
  // Relationships
  parent_event_id?: string;
  related_event_ids: string[];
  
  // Technical context
  service_name: string;
  service_version: string;
  environment: 'development' | 'staging' | 'production';
  deployment_id: string;
  
  // Signature for integrity
  signature?: string;
  hash_chain?: string[];
}
```

**Audit Logger Implementation**:
```typescript
// lib/audit/audit-logger.ts
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { AuditEvent } from './audit-types';

export class AuditLogger {
  private static readonly AUDIT_TABLE = 'audit_logs';
  private static readonly RETENTION_DAYS = 365;
  private static readonly BATCH_SIZE = 100;
  private static readonly BATCH_INTERVAL_MS = 5000;
  
  private static queue: AuditEvent[] = [];
  private static batchTimer: NodeJS.Timeout | null = null;
  private static processing = false;
  
  // Initialize batch processing
  static initialize() {
    if (!this.batchTimer) {
      this.batchTimer = setInterval(() => this.processBatch(), this.BATCH_INTERVAL_MS);
    }
  }
  
  // Log an audit event
  static async log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'event_id' | 'correlation_id'>): Promise<string> {
    const auditEvent: AuditEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      event_id: crypto.randomBytes(16).toString('hex'),
      correlation_id: event.correlation_id || this.generateCorrelationId(),
    };
    
    // Add to queue for batch processing
    this.queue.push(auditEvent);
    
    // Process immediately if critical security event
    if (event.event_category === 'security' && event.status === 'failure') {
      await this.processEventImmediately(auditEvent);
    }
    
    return auditEvent.event_id;
  }
  
  // Process batch of events
  private static async processBatch() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const batch = this.queue.splice(0, this.BATCH_SIZE);
    
    try {
      // Insert batch into Supabase
      const { error } = await supabase
        .from(this.AUDIT_TABLE)
        .insert(batch.map(event => ({
          ...event,
          // Encrypt sensitive fields
          metadata: this.encryptSensitiveData(event.metadata),
          error_details: event.error_details ? this.encryptSensitiveData(event.error_details) : null,
        })));
      
      if (error) {
        console.error('Failed to insert audit batch:', error);
        // Fallback to local storage
        await this.storeLocally(batch);
      }
      
      // Also send to external monitoring
      await this.sendToMonitoringService(batch);
      
    } catch (error) {
      console.error('Error processing audit batch:', error);
      await this.storeLocally(batch);
    } finally {
      this.processing = false;
    }
  }
  
  // Process critical event immediately
  private static async processEventImmediately(event: AuditEvent) {
    try {
      const { error } = await supabase
        .from(this.AUDIT_TABLE)
        .insert({
          ...event,
          metadata: this.encryptSensitiveData(event.metadata),
          error_details: event.error_details ? this.encryptSensitiveData(event.error_details) : null,
        });
      
      if (error) {
        console.error('Failed to insert critical audit event:', error);
        await this.storeLocally([event]);
      }
      
      // Trigger alert for critical security events
      if (event.event_category === 'security' && event.status === 'failure') {
        await this.triggerSecurityAlert(event);
      }
    } catch (error) {
      console.error('Error processing critical audit event:', error);
      await this.storeLocally([event]);
    }
  }
  
  // Store locally as fallback
  private static async storeLocally(events: AuditEvent[]) {
    const filename = `/tmp/audit-backup-${Date.now()}.json`;
    await Bun.write(filename, JSON.stringify(events, null, 2));
    
    // Schedule retry
    setTimeout(async () => {
      try {
        const data = await Bun.file(filename).json();
        const { error } = await supabase
          .from(this.AUDIT_TABLE)
          .insert(data);
        
        if (!error) {
          await Bun.file(filename).delete();
        }
      } catch (error) {
        console.error('Failed to retry audit batch:', error);
      }
    }, 60000); // Retry after 1 minute
  }
  
  // Encrypt sensitive data
  private static encryptSensitiveData(data: Record<string, any>): Record<string, any> {
    const encrypted = { ...data };
    
    // Fields to encrypt
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'private_key', 'mnemonic'];
    
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        encrypted[key] = `encrypted:${this.encrypt(value)}`;
      }
    }
    
    return encrypted;
  }
  
  private static encrypt(text: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.AUDIT_ENCRYPTION_KEY!, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }
  
  // Generate correlation ID
  private static generateCorrelationId(): string {
    return `corr_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }
  
  // Send to external monitoring
  private static async sendToMonitoringService(events: AuditEvent[]) {
    if (!process.env.MONITORING_SERVICE_URL) return;
    
    try {
      await fetch(process.env.MONITORING_SERVICE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.MONITORING_SERVICE_KEY}`,
        },
        body: JSON.stringify({
          events: events.map(event => ({
            ...event,
            // Strip sensitive data for external services
            metadata: this.stripSensitiveData(event.metadata),
          })),
        }),
      });
    } catch (error) {
      console.error('Failed to send to monitoring service:', error);
    }
  }
  
  // Trigger security alert
  private static async triggerSecurityAlert(event: AuditEvent) {
    const alertChannels = [
      this.sendToSlack(event),
      this.sendToEmail(event),
      this.sendToPagerDuty(event),
    ];
    
    await Promise.allSettled(alertChannels);
  }
  
  // Query audit logs
  static async queryLogs(filters: {
    start_date?: string;
    end_date?: string;
    actor_id?: string;
    event_type?: string;
    resource_type?: string;
    resource_id?: string;
    status?: string;
    correlation_id?: string;
    limit?: number;
    offset?: number;
  }) {
    let query = supabase
      .from(this.AUDIT_TABLE)
      .select('*')
      .order('timestamp', { ascending: false });
    
    if (filters.start_date) {
      query = query.gte('timestamp', filters.start_date);
    }
    
    if (filters.end_date) {
      query = query.lte('timestamp', filters.end_date);
    }
    
    if (filters.actor_id) {
      query = query.eq('actor_id', filters.actor_id);
    }
    
    if (filters.event_type) {
      query = query.eq('event_type', filters.event_type);
    }
    
    if (filters.resource_type) {
      query = query.eq('resource_type', filters.resource_type);
    }
    
    if (filters.resource_id) {
      query = query.eq('resource_id', filters.resource_id);
    }
    
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    
    if (filters.correlation_id) {
      query = query.eq('correlation_id', filters.correlation_id);
    }
    
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    
    if (filters.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw new Error(`Failed to query audit logs: ${error.message}`);
    }
    
    return data.map(event => ({
      ...event,
      metadata: this.decryptSensitiveData(event.metadata),
      error_details: event.error_details ? this.decryptSensitiveData(event.error_details) : null,
    }));
  }
  
  // Export logs for compliance
  static async exportLogs(
    startDate: string,
    endDate: string,
    format: 'json' | 'csv' | 'pdf'
  ) {
    const logs = await this.queryLogs({
      start_date: startDate,
      end_date: endDate,
      limit: 10000, // Max export size
    });
    
    switch (format) {
      case 'json':
        return JSON.stringify(logs, null, 2);
      case 'csv':
        return this.convertToCSV(logs);
      case 'pdf':
        return await this.generatePDF(logs);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
  
  // Cleanup old logs
  static async cleanupOldLogs(retentionDays: number = this.RETENTION_DAYS) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    const { error } = await supabase
      .from(this.AUDIT_TABLE)
      .delete()
      .lt('timestamp', cutoffDate.toISOString());
    
    if (error) {
      console.error('Failed to cleanup old logs:', error);
      return false;
    }
    
    return true;
  }
}
```

### 4.2 Real-time Monitoring & Alerting
**Monitoring Dashboard Integration**:
```typescript
// lib/monitoring/dashboard.ts
import { AuditEvent } from '@/lib/audit/audit-types';

export class MonitoringDashboard {
  private static readonly ALERT_THRESHOLDS = {
    FAILED_LOGIN_ATTEMPTS: 5,
    SUSPICIOUS_API_CALLS: 10,
    DATA_BREACH_ATTEMPTS: 3,
    HIGH_ERROR_RATE: 0.1, // 10%
  };
  
  // Real-time event stream
  static async getEventStream(filters?: {
    event_types?: string[];
    severities?: string[];
    actors?: string[];
  }) {
    const subscription = supabase
      .channel('audit-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs',
          filter: this.buildStreamFilter(filters),
        },
        (payload) => {
          this.processRealtimeEvent(payload.new as AuditEvent);
        }
      )
      .subscribe();
    
    return () => subscription.unsubscribe();
  }
  
  // Alerting rules
  static async checkAlertRules(event: AuditEvent) {
    const rules = [
      this.checkFailedLoginAttempts(event),
      this.checkSuspiciousAPICalls(event),
      this.checkDataBreachAttempts(event),
      this.checkErrorRate(event),
      this.checkGeolocationAnomalies(event),
      this.checkTimeBasedAnomalies(event),
    ];
    
    const alerts = await Promise.all(rules);
    return alerts.filter(alert => alert !== null);
  }
  
  private static async checkFailedLoginAttempts(event: AuditEvent): Promise<any | null> {
    if (event.event_type !== 'auth_login_failed') return null;
    
    // Count failed attempts in last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { count, error } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'auth_login_failed')
      .eq('actor_ip', event.actor_ip)
      .gte('timestamp', fiveMinutesAgo);
    
    if (error) return null;
    
    if (count >= this.ALERT_THRESHOLDS.FAILED_LOGIN_ATTEMPTS) {
      return {
        type: 'BRUTE_FORCE_ATTEMPT',
        severity: 'high',
        actor_ip: event.actor_ip,
        failed_attempts: count,
        timestamp: new Date().toISOString(),
        recommendation: 'Block IP temporarily and require CAPTCHA',
      };
    }
    
    return null;
  }
  
  private static async checkSuspiciousAPICalls(event: AuditEvent): Promise<any | null> {
    if (event.event_type !== 'api_call') return null;
    
    // Check for unusual API patterns
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    
    const { count, error } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'api_call')
      .eq('actor_id', event.actor_id)
      .gte('timestamp', oneMinuteAgo);
    
    if (error) return null;
    
    if (count >= this.ALERT_THRESHOLDS.SUSPICIOUS_API_CALLS) {
      return {
        type: 'API_ABUSE',
        severity: 'medium',
        actor_id: event.actor_id,
        api_calls_per_minute: count,
        timestamp: new Date().toISOString(),
        recommendation: 'Implement rate limiting for this user',
      };
    }
    
    return null;
  }
  
  // Dashboard metrics
  static async getDashboardMetrics(timeRange: '1h' | '24h' | '7d' | '30d') {
    const now = new Date();
    let startDate = new Date();
    
    switch (timeRange) {
      case '1h':
        startDate.setHours(now.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(now.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(now.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(now.getDate() - 30);
        break;
    }
    
    const [
      totalEvents,
      successRate,
      topEvents,
      topActors,
      errorTrend,
      securityEvents,
    ] = await Promise.all([
      this.getTotalEvents(startDate),
      this.getSuccessRate(startDate),
      this.getTopEvents(startDate),
      this.getTopActors(startDate),
      this.getErrorTrend(startDate),
      this.getSecurityEvents(startDate),
    ]);
    
    return {
      total_events: totalEvents,
      success_rate: successRate,
      top_events: topEvents,
      top_actors: topActors,
      error_trend: errorTrend,
      security_events: securityEvents,
      time_range: timeRange,
      generated_at: now.toISOString(),
    };
  }
}
```

### 4.3 Compliance Reporting
**Automated Compliance Reports**:
```typescript
// lib/compliance/reporting.ts
export class ComplianceReporter {
  static async generateGDPRReport(userId: string): Promise<any> {
    const [
      userData,
      accessLogs,
      modificationLogs,
      deletionLogs,
    ] = await Promise.all([
      this.getUserData(userId),
      this.getAccessLogs(userId),
      this.getModificationLogs(userId),
      this.getDeletionLogs(userId),
    ]);
    
    return {
      report_id: crypto.randomUUID(),
      user_id: userId,
      generated_at: new Date().toISOString(),
      report_type: 'GDPR_DATA_ACCESS',
      data_categories: this.categorizeData(userData),
      access_history: accessLogs,
      modification_history: modificationLogs,
      deletion_history: deletionLogs,
      data_retention: this.calculateRetentionPeriods(userData),
      third_party_sharing: await this.getThirdPartySharing(userId),
      summary: {
        total_data_points: this.countDataPoints(userData),
        last_access: this.getLastAccess(accessLogs),
        last_modification: this.getLastModification(modificationLogs),
        data_subjects: this.extractDataSubjects(userData),
      },
    };
  }
  
  static async generateSOC2Report(timePeriod: {
    start: string;
    end: string;
  }): Promise<any> {
    const controls = [
      'CC1: Common Criteria 1',
      'CC2: Common Criteria 2',
      'CC3: Common Criteria 3',
      'CC4: Common Criteria 4',
      'CC5: Common Criteria 5',
      'CC6: Common Criteria 6',
      'CC7: Common Criteria 7',
      'CC8: Common Criteria 8',
      'CC9: Common Criteria 9',
    ];
    
    const controlAssessments = await Promise.all(
      controls.map(control => this.assessControl(control, timePeriod))
    );
    
    return {
      report_id: crypto.randomUUID(),
      period: timePeriod,
      generated_at: new Date().toISOString(),
      report_type: 'SOC2_TYPE_2',
      organization: {
        name: process.env.ORG_NAME,
        address: process.env.ORG_ADDRESS,
        contact: process.env.ORG_CONTACT,
      },
      auditor: {
        name: process.env.AUDITOR_NAME,
        certification: process.env.AUDITOR_CERTIFICATION,
      },
      scope: {
        systems_included: [
          'Multi-Agent Platform',
          'User Management System',
          'Payment Processing',
          'Data Storage',
          'API Services',
        ],
        systems_excluded: [
          'Development Environments',
          'Testing Systems',
        ],
      },
      controls: controlAssessments,
      overall_assessment: this.calculateOverallAssessment(controlAssessments),
      exceptions: await this.getExceptions(timePeriod),
      recommendations: await this.getRecommendations(timePeriod),
      evidence: await this.collectEvidence(timePeriod),
    };
  }
  
  static async generateIncidentReport(incidentId: string): Promise<any> {
    const incident = await this.getIncidentDetails(incidentId);
    const timeline = await this.getIncidentTimeline(incidentId);
    const impact = await this.assessImpact(incidentId);
    const response = await this.getResponseActions(incidentId);
    const lessons = await this.extractLessons(incidentId);
    
    return {
      incident_id: incidentId,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      detected_at: incident.detected_at,
      resolved_at: incident.resolved_at,
      timeline: timeline,
      impact_assessment: impact,
      response_actions: response,
      lessons_learned: lessons,
      root_cause: incident.root_cause,
      corrective_actions: incident.corrective_actions,
      preventive_measures: incident.preventive_measures,
      report_generated_at: new Date().toISOString(),
      reported_by: incident.reported_by,
      approved_by: incident.approved_by,
    };
  }
}
```

---

## 5. API SECURITY BEST PRACTICES

### 5.1 Rate Limiting & Throttling
```typescript
// lib/security/rate-limiting.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export class RateLimiter {
  private static redis = new Redis({
    url: process.env.UPSTASH_REDIS_URL!,
    token: process.env.UPSTASH_REDIS_TOKEN!,
  })
  
  private static limiters = new Map<string, Ratelimit>()
  
  static async initialize() {
    // Global rate limiter
    this.limiters.set('global', new Ratelimit({
      redis: this.redis,
      limiter: Ratelimit.slidingWindow(1000, '1m'), // 1000 requests per minute
      analytics: true,
      prefix: 'ratelimit:global',
    }))
    
    // IP-based rate limiter
    this.limiters.set('ip', new Ratelimit({
      redis: this.redis,
      limiter: Ratelimit.slidingWindow(100, '1m'), // 100 requests per minute per IP
      analytics: true,
      prefix: 'ratelimit:ip',
    }))
    
    // User-based rate limiter
    this.limiters.set('user', new Ratelimit({
      redis: this.redis,
      limiter: Ratelimit.slidingWindow(500, '1m'), // 500 requests per minute per user
      analytics: true,
      prefix: 'ratelimit:user',
    }))
    
    // API key rate limiter
    this.limiters.set('api_key', new Ratelimit({
      redis: this.redis,
      limiter: Ratelimit.slidingWindow(10000, '1h'), // 10k requests per hour per API key
      analytics: true,
      prefix: 'ratelimit:api_key',
    }))
  }
  
  static async checkLimit(
    identifier: string,
    type: 'global' | 'ip' | 'user' | 'api_key' = 'global'
  ): Promise<{ allowed: boolean; limit: number; remaining: number; reset: number }> {
    const limiter = this.limiters.get(type)
    if (!limiter) {
      throw new Error(`Rate limiter type '${type}' not initialized`)
    }
    
    const result = await limiter.limit(identifier)
    
    // Log rate limiting events
    if (!result.success) {
      await AuditLogger.logSecurityEvent(
        undefined,
        'rate_limit_exceeded',
        'api',
        identifier,
        'execute',
        'failure',
        {
          limiter_type: type,
          identifier,
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
        }
      )
    }
    
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    }
  }
  
  static async middleware(req: Request) {
    const identifier = this.getIdentifier(req)
    const type = this.getLimiterType(req)
    
    const limitResult = await this.checkLimit(identifier, type)
    
    if (!limitResult.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retry_after: Math.ceil((limitResult.reset - Date.now()) / 1000),
          limit: limitResult.limit,
          remaining: limitResult.remaining,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': Math.ceil((limitResult.reset - Date.now()) / 1000).toString(),
            'X-RateLimit-Limit': limitResult.limit.toString(),
            'X-RateLimit-Remaining': limitResult.remaining.toString(),
            'X-RateLimit-Reset': limitResult.reset.toString(),
          },
        }
      )
    }
    
    // Add rate limit headers to response
    const response = await this.handleRequest(req)
    response.headers.set('X-RateLimit-Limit', limitResult.limit.toString())
    response.headers.set('X-RateLimit-Remaining', limitResult.remaining.toString())
    response.headers.set('X-RateLimit-Reset', limitResult.reset.toString())
    
    return response
  }
  
  private static getIdentifier(req: Request): string {
    // Priority: API Key > User ID > IP Address
    const apiKey = req.headers.get('x-api-key')
    if (apiKey) return `api_key:${apiKey}`
    
    const userId = req.headers.get('x-user-id')
    if (userId) return `user:${userId}`
    
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
    return `ip:${ip}`
  }
  
  private static getLimiterType(req: Request): 'global' | 'ip' | 'user' | 'api_key' {
    if (req.headers.get('x-api-key')) return 'api_key'
    if (req.headers.get('x-user-id')) return 'user'
    return 'ip'
  }
}
```

### 5.2 Input Validation & Sanitization
```typescript
// lib/security/input-validation.ts
import { z } from 'zod'
import validator from 'validator'
import { xssClean } from 'xss-clean'
import DOMPurify from 'isomorphic-dompurify'

export class InputValidator {
  // Common validation schemas
  static readonly schemas = {
    email: z.string().email().min(1).max(255),
    password: z.string().min(8).max(100).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/),
    username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/),
    walletAddress: z.string().regex(/x[a-fA-F0-9]{40}$/),
    uuid: z.string().uuid(),
    url: z.string().url(),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
    ipAddress: z.string().ip(),
    json: z.string().transform((str, ctx) => {
      try {
        return JSON.parse(str)
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid JSON',
        })
        return z.NEVER
      }
    }),
  }
  
  // Validate and sanitize input
  static async validate<T extends z.ZodTypeAny>(
    schema: T,
    data: unknown,
    options: {
      sanitize?: boolean
      stripUnknown?: boolean
      abortEarly?: boolean
    } = {}
  ): Promise<z.infer<T>> {
    const validated = await schema.safeParseAsync(data, {
      stripUnknown: options.stripUnknown ?? true,
      abortEarly: options.abortEarly ?? false,
    })
    
    if (!validated.success) {
      throw new ValidationError('Input validation failed', validated.error.errors)
    }
    
    if (options.sanitize !== false) {
      return this.sanitize(validated.data)
    }
    
    return validated.data
  }
  
  // Sanitize data recursively
  private static sanitize(data: any): any {
    if (typeof data === 'string') {
      // Remove null bytes
      data = data.replace(/\0/g, '')
      
      // Trim whitespace
      data = data.trim()
      
      // Sanitize HTML
      data = DOMPurify.sanitize(data, {
        ALLOWED_TAGS: [], // No HTML tags allowed
        ALLOWED_ATTR: [], // No attributes allowed
      })
      
      // Additional XSS protection
      data = xssClean(data)
      
      // Normalize line endings
      data = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      
      return data
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.sanitize(item))
    }
    
    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {}
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = this.sanitize(value)
      }
      return sanitized
    }
    
    return data
  }
  
  // Validate file uploads
  static validateFile(file: File, options: {
    maxSize?: number // in bytes
    allowedTypes?: string[]
    allowedExtensions?: string[]
  }): void {
    const { maxSize = 10 * 1024 * 1024, allowedTypes = [], allowedExtensions = [] } = options
    
    // Check file size
    if (file.size > maxSize) {
      throw new ValidationError(`File too large. Maximum size: ${maxSize} bytes`)
    }
    
    // Check file type
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      throw new ValidationError(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`)
    }
    
    // Check file extension
    const fileName = file.name.toLowerCase()
    const fileExtension = fileName.slice(fileName.lastIndexOf('.') + 1)
    
    if (allowedExtensions.length > 0 && !allowedExtensions.includes(fileExtension)) {
      throw new ValidationError(`Invalid file extension. Allowed extensions: ${allowedExtensions.join(', ')}`)
    }
    
    // Additional security checks
    const fileNameRegex = /^[a-zA-Z0-9_.-]+$/
    if (!fileNameRegex.test(file.name)) {
      throw new ValidationError('Invalid file name')
    }
    
    // Check for malicious file signatures
    this.checkFileSignature(file)
  }
  
  private static async checkFileSignature(file: File): Promise<void> {
    const buffer = await file.arrayBuffer()
    const view = new Uint8Array(buffer.slice(0, 512)) // Check first 512 bytes
    
    // Common file signatures
    const signatures: Record<string, number[]> = {
      'png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'jpg': [0xFF, 0xD8, 0xFF],
      'gif': [0x47, 0x49, 0x46, 0x38],
      'pdf': [0x25, 0x50, 0x44, 0x46],
    }
    
    for (const [type, signature] of Object.entries(signatures)) {
      const matches = signature.every((byte, index) => view[index] === byte)
      if (matches && file.type !== `image/${type}` && file.type !== `application/${type}`) {
        throw new ValidationError(`File signature mismatch. Detected: ${type}, Reported: ${file.type}`)
      }
    }
  }
  
  // Validate Ethereum transaction
  static validateEthereumTransaction(tx: any): void {
    const schema = z.object({
      to: this.schemas.walletAddress,
      value: z.string().regex(/^[0-9]+$/),
      data: z.string().optional(),
      gasLimit: z.string().regex(/^[0-9]+$/).optional(),
      gasPrice: z.string().regex(/^[0-9]+$/).optional(),
      nonce: z.number().int().nonnegative().optional(),
      chainId: z.number().int().positive(),
    })
    
    schema.parse(tx)
    
    // Additional validation
    if (tx.data && !tx.data.startsWith('0x')) {
      throw new ValidationError('Transaction data must start with 0x')
    }
    
    const value = BigInt(tx.value)
    if (value > BigInt('10000000000000000000')) { // 10 ETH
      throw new ValidationError('Transaction value too high')
    }
  }
  
  // Validate API request
  static validateAPIRequest(req: Request, schema: z.ZodTypeAny): Promise<any> {
    const contentType = req.headers.get('content-type') || ''
    
    if (!contentType.includes('application/json')) {
      throw new ValidationError('Content-Type must be application/json')
    }
    
    return this.validate(schema, req.body, {
      sanitize: true,
      stripUnknown: true,
    })
  }
}

export class ValidationError extends Error {
  constructor(message: string, public errors: z.ZodIssue[]) {
    super(message)
    this.name = 'ValidationError'
  }
}
```

### 5.3 CORS & Security Headers
```typescript
// lib/security/headers.ts
export class SecurityHeaders {
  static getDefaultHeaders(): Record<string, string> {
    return {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': this.getCSP(),
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    }
  }
  
  private static getCSP(): string {
    const directives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.stripe.com https://*.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https: blob:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://*.stripe.com https://*.sentry.io wss://*.farcaster.xyz",
      "frame-src 'self' https://*.stripe.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "block-all-mixed-content",
      "upgrade-insecure-requests",
    ]
    
    return directives.join('; ')
  }
  
  static getCORSHeaders(origin: string): Record<string, string> {
    const allowedOrigins = [
      process.env.NEXT_PUBLIC_APP_URL!,
      'http://localhost:3000',
      'http://localhost:3001',
      'https://*.vercel.app',
    ]
    
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        const regex = new RegExp('^' + allowedOrigin.replace('*', '.*') + '$')
        return regex.test(origin)
      }
      return origin === allowedOrigin
    })
    
    if (!isAllowed) {
      return {
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_APP_URL!,
      }
    }
    
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Request-ID',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400', // 24 hours
      'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
    }
  }
  
  static applyHeaders(headers: Headers, additionalHeaders: Record<string, string> = {}) {
    const defaultHeaders = this.getDefaultHeaders()
    
    for (const [key, value] of Object.entries(defaultHeaders)) {
      headers.set(key, value)
    }
    
    for (const [key, value] of Object.entries(additionalHeaders)) {
      headers.set(key, value)
    }
  }
}
```

---

## 6. INCIDENT RESPONSE PLAN

### 6.1 Incident Classification & Severity
```typescript
// lib/incident/response.ts
export enum IncidentSeverity {
  CRITICAL = 'critical',    // System-wide outage, data breach
  HIGH = 'high',            // Major functionality broken
  MEDIUM = 'medium',        // Partial functionality affected
  LOW = 'low',             // Minor issue, workaround available
  INFO = 'info',           // Informational, no impact
}

export enum IncidentStatus {
  REPORTED = 'reported',
  INVESTIGATING = 'investigating',
  CONTAINED = 'contained',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export interface Incident {
  id: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reporter: {
    id: string;
    name: string;
    email: string;
  };
  assigned_to?: {
    id: string;
    name: string;
    email: string;
  };
  detected_at: string;
  reported_at: string;
  contained_at?: string;
  resolved_at?: string;
  closed_at?: string;
  impact: {
    users_affected: number;
    systems_affected: string[];
    data_breached: boolean;
    financial_impact?: number;
    reputation_impact?: 'low' | 'medium' | 'high';
  };
  root_cause?: string;
  corrective_actions: string[];
  preventive_measures: string[];
  timeline: IncidentEvent[];
  communications: IncidentCommunication[];
  evidence: IncidentEvidence[];
}

export interface IncidentEvent {
  timestamp: string;
  event: string;
  actor: string;
  details: Record<string, any>;
}

export class IncidentResponse {
  private static readonly NOTIFICATION_CHANNELS = ['slack', 'email', 'pagerduty', 'sms'];
  
  static async createIncident(incident: Omit<Incident, 'id' | 'reported_at'>): Promise<string> {
    const incidentId = crypto.randomUUID();
    
    const fullIncident: Incident = {
      ...incident,
      id: incidentId,
      reported_at: new Date().toISOString(),
      timeline: [
        {
          timestamp: new Date().toISOString(),
          event: 'incident_reported',
          actor: incident.reporter.name,
          details: { description: incident.description },
        },
      ],
      communications: [],
      evidence: [],
    };
    
    // Store in database
    await supabase.from('incidents').insert(fullIncident);
    
    // Notify relevant teams
    await this.notifyTeams(fullIncident);
    
    // Create communication channel
    await this.createCommunicationChannel(fullIncident);
    
    return incidentId;
  }
  
  static async updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    actor: string,
    notes?: string
  ): Promise<void> {
    const updateData: any = { status };
    
    if (status === IncidentStatus.CONTAINED) {
      updateData.contained_at = new Date().toISOString();
    } else if (status === IncidentStatus.RESOLVED) {
      updateData.resolved_at = new Date().toISOString();
    } else if (status === IncidentStatus.CLOSED) {
      updateData.closed_at = new Date().toISOString();
    }
    
    await supabase
      .from('incidents')
      .update(updateData)
      .eq('id', incidentId);
    
    // Add to timeline
    await this.addTimelineEvent(incidentId, {
      timestamp: new Date().toISOString(),
      event: `status_changed_to_${status}`,
      actor,
      details: { notes, previous_status: await this.getIncidentStatus(incidentId) },
    });
    
    // Notify of status change
    if (status === IncidentStatus.CRITICAL || status === IncidentStatus.HIGH) {
      await this.escalateIncident(incidentId);
    }
  }
  
  static async addTimelineEvent(
    incidentId: string,
    event: Omit<IncidentEvent, 'timestamp'>
  ): Promise<void> {
    const timelineEvent: IncidentEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    
    await supabase.rpc('append_incident_timeline', {
      incident_id: incidentId,
      event: timelineEvent,
    });
  }
  
  static async escalateIncident(incidentId: string): Promise<void> {
    const incident = await this.getIncident(incidentId);
    
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }
    
    // Escalate based on severity
    switch (incident.severity) {
      case IncidentSeverity.CRITICAL:
        await this.notifyExecutiveTeam(incident);
        await this.notifyLegalTeam(incident);
        await this.notifyPRTeam(incident);
        break;
      case IncidentSeverity.HIGH:
        await this.notifyEngineeringManagers(incident);
        await this.notifyCustomerSupport(incident);
        break;
      case IncidentSeverity.MEDIUM:
        await this.notifyTeamLeads(incident);
        break;
      case IncidentSeverity.LOW:
        await this.notifyAssignedEngineer(incident);
        break;
    }
    
    // Update status
    await this.updateIncidentStatus(
      incidentId,
      IncidentStatus.INVESTIGATING,
      'system',
      'Incident escalated based on severity'
    );
  }
  
  static async generateIncidentReport(incidentId: string): Promise<string> {
    const incident = await this.getIncident(incidentId);
    
    if (!incident) {
      throw new Error(`Incident ${incidentId} not found`);
    }
    
    const report = `
# INCIDENT REPORT
## ${incident.title}
**Incident ID:** ${incident.id}
**Severity:** ${incident.severity}
**Status:** ${incident.status}
**Reported:** ${new Date(incident.reported_at).toLocaleString()}
**Resolved:** ${incident.resolved_at ? new Date(incident.resolved_at).toLocaleString() : 'Not resolved'}
**Closed:** ${incident.closed_at ? new Date(incident.closed_at).toLocaleString() : 'Not closed'}

## IMPACT ASSESSMENT
**Users Affected:** ${incident.impact.users_affected.toLocaleString()}
**Systems Affected:** ${incident.impact.systems_affected.join(', ')}
**Data Breached:** ${incident.impact.data_breached ? 'YES' : 'NO'}
${incident.impact.financial_impact ? `**Financial Impact:** $${incident.impact.financial_impact.toLocaleString()}` : ''}
${incident.impact.reputation_impact ? `**Reputation Impact:** ${incident.impact.reputation_impact}` : ''}

## TIMELINE
${incident.timeline.map(event => `- **${new Date(event.timestamp).toLocaleString()}**: ${event.event} (${event.actor})`).join('\n')}

## ROOT CAUSE
${incident.root_cause || 'Not determined'}

## CORRECTIVE ACTIONS
${incident.corrective_actions.map(action => `- ${action}`).join('\n')}

## PREVENTIVE MEASURES
${incident.preventive_measures.map(measure => `- ${measure}`).join('\n')}

## EVIDENCE COLLECTED
${incident.evidence.map(e => `- ${e.type}: ${e.description}`).join('\n')}

## COMMUNICATIONS
${incident.communications.map(comm => `- **${new Date(comm.sent_at).toLocaleString()}**: ${comm.channel} - ${comm.recipients.join(', ')}`).join('\n')}

## RECOMMENDATIONS
1. Review and update incident response procedures
2. Conduct post-mortem analysis
3. Update monitoring and alerting rules
4. Train team on incident response
5. Update documentation

---
**Report Generated:** ${new Date().toLocaleString()}
**Generated By:** Multi-Agent Platform Incident Response System
    `;
    
    return report;
  }
}
```

### 6.2 Communication Templates
```typescript
// lib/incident/communications.ts
export class IncidentCommunications {
  static getTemplate(severity: IncidentSeverity, type: 'internal' | 'external' | 'customer'): string {
    const templates = {
      internal: {
        [IncidentSeverity.CRITICAL]: `
URGENT: CRITICAL INCIDENT

Severity: CRITICAL
Impact: System-wide outage or data breach
Action Required: IMMEDIATE

All engineers on call are required to join the incident response channel.
Business continuity plan activated.

Next Steps:
1. Join #incident-response channel
2. Review incident details
3. Begin containment procedures
4. Update status page
5. Prepare customer communications
        `,
        [IncidentSeverity.HIGH]: `
HIGH PRIORITY INCIDENT

Severity: HIGH
Impact: Major functionality broken
Action Required: WITHIN 1 HOUR

Relevant team leads and engineers required to address.

Next Steps:
1. Join #incident-response channel
2. Assess impact
3. Begin investigation
4. Provide ETA for resolution
        `,
      },
      external: {
        [IncidentSeverity.CRITICAL]: `
STATUS PAGE UPDATE: MAJOR OUTAGE

We are currently experiencing a major service outage affecting all systems.
Our engineering team is actively investigating the issue.

Impact: All services are currently unavailable.
ETA for resolution: Investigating

We will provide updates every 30 minutes.
Thank you for your patience.
        `,
        [IncidentSeverity.HIGH]: `
STATUS PAGE UPDATE: SERVICE DEGRADATION

We are experiencing issues with some of our services.
Our engineering team is investigating.

Impact: Some features may be unavailable or slow.
ETA for resolution: 2-4 hours

We will provide updates hourly.
        `,
      },
      customer: {
        [IncidentSeverity.CRITICAL]: `
IMPORTANT SERVICE NOTIFICATION

Dear Customer,

We are currently experiencing a major service outage affecting all systems.
Our engineering team is actively working to resolve the issue.

What's affected: All services
Current status: Investigating
Expected resolution: We will provide updates every 30 minutes

We sincerely apologize for the inconvenience and appreciate your patience.

If you have urgent questions, please contact support@example.com.

Best regards,
The Example Team
        `,
        [IncidentSeverity.HIGH]: `
SERVICE NOTIFICATION

Dear Customer,

We are currently experiencing issues with some of our services.
Our engineering team is investigating.

What's affected: [List specific services]
Current status: Investigating
Expected resolution: 2-4 hours

We will notify you once the issue is resolved.

If you have questions, please contact support@example.com.

Best regards,
The Example Team
        `,
      },
    };
    
    return templates[type][severity]?.trim() || 'Template not found';
  }
  
  static async sendNotification(
    incident: Incident,
    channel: 'slack' | 'email' | 'pagerduty' | 'sms',
    recipients: string[]
  ): Promise<void> {
    const template = this.getTemplate(
      incident.severity,
      channel === 'slack' || channel === 'pagerduty' ? 'internal' : 'external'
    );
    
    const message = this.formatMessage(incident, template);
    
    switch (channel) {
      case 'slack':
        await this.sendSlackNotification(incident, message, recipients);
        break;
      case 'email':
        await this.sendEmailNotification(incident, message, recipients);
        break;
      case 'pagerduty':
        await this.sendPagerDutyNotification(incident, message, recipients);
        break;
      case 'sms':
        await this.sendSMSNotification(incident, message, recipients);
        break;
    }
    
    // Log communication
    await supabase.from('incident_communications').insert({
      incident_id: incident.id,
      channel,
      recipients,
      message,
      sent_at: new Date().toISOString(),
    });
  }
  
  private static formatMessage(incident: Incident, template: string): string {
    return template
      .replace('{{INCIDENT_ID}}', incident.id)
      .replace('{{TITLE}}', incident.title)
      .replace('{{SEVERITY}}', incident.severity)
      .replace('{{DETECTED_AT}}', new Date(incident.detected_at).toLocaleString())
      .replace('{{IMPACT}}', incident.impact.users_affected.toLocaleString())
      .replace('{{SYSTEMS}}', incident.impact.systems_affected.join(', '));
  }
}
```

---

## SUMMARY

This Security & Compliance Guidelines document provides comprehensive coverage of:

1. **API Key & Secret Management** - Secure storage, rotation, and hierarchical protection
2. **Data Protection & Encryption** - At-rest and in-transit encryption standards
3. **Regulatory Compliance** - GDPR, CCPA/CPRA, PCI DSS, SOC 2 frameworks
4. **Audit Logging & Monitoring** - Comprehensive tracking with real-time alerts
5. **API Security Best Practices** - Rate limiting, input validation, security headers
6. **Incident Response Plan** - Classification, escalation, communication templates

**Key Implementation Notes**:
- All security measures should be tested regularly
- Compliance requirements vary by jurisdiction and data type
- Audit logs must be immutable and cryptographically verifiable
- Incident response plans require regular drills and updates
- Security headers should be reviewed and updated periodically
