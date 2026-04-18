# **File 7: Performance Optimization Patterns**

**File:** `performance-patterns.md`  
**Location:** `~/.venice agent-trinity/integration-explainer/patterns/PERFORMANCE_PATTERNS.md`

```markdown
# PERFORMANCE OPTIMIZATION PATTERNS

## OVERVIEW
Comprehensive performance optimization strategies for the multi-agent platform. Covers caching, database optimization, image optimization, bundle size reduction, and real-time monitoring.

---

## 1. CACHING STRATEGIES

### 1.1 Multi-Layer Caching Architecture
**Principle**: Implement caching at multiple levels (CDN, server, database, browser) for optimal performance.

**Implementation**:
```typescript
// lib/caching/multi-layer-cache.ts
import { Redis } from '@upstash/redis'
import { LRUCache } from 'lru-cache'
import NodeCache from 'node-cache'

export interface CacheEntry<T = any> {
  data: T
  metadata: {
    cachedAt: number
    expiresAt: number
    etag: string
    version: number
    tags: string[]
  }
}

export class MultiLayerCache {
  // Layer 1: In-memory LRU cache (fastest, most limited)
  private static l1Cache = new LRUCache<string, CacheEntry>({
    max: 1000, // 1000 items
    ttl: 1000 * 60 * 5, // 5 minutes
    updateAgeOnGet: true,
    allowStale: false,
  })

  // Layer 2: Node cache (shared memory)
  private static l2Cache = new NodeCache({
    stdTTL: 300, // 5 minutes
    checkperiod: 60, // 1 minute
    useClones: false,
  })

  // Layer 3: Redis (distributed cache)
  private static l3Cache = new Redis({
    url: process.env.REDIS_URL!,
    token: process.env.REDIS_TOKEN!,
  })

  // Layer 4: CDN cache (via Vercel Edge Config)
  private static cdnCache = new Map<string, CacheEntry>()

  // Browser cache (via headers)
  private static browserCache = new Map<string, CacheEntry>()

  static async get<T>(
    key: string,
    options: {
      layers?: ('l1' | 'l2' | 'l3' | 'cdn' | 'browser')[]
      ttl?: number
      tags?: string[]
      staleWhileRevalidate?: boolean
      staleIfError?: boolean
    } = {}
  ): Promise<T | null> {
    const {
      layers = ['l1', 'l2', 'l3', 'cdn'],
      ttl = 300, // 5 minutes default
      tags = [],
      staleWhileRevalidate = true,
      staleIfError = true,
    } = options

    // Try each cache layer in order
    for (const layer of layers) {
      try {
        const cached = await this.getFromLayer<T>(layer, key)
        if (cached) {
          // Check if expired
          if (cached.metadata.expiresAt > Date.now()) {
            // Valid cache hit
            this.promoteToL1(key, cached)
            return cached.data
          }

          // Cache stale but usable with stale-while-revalidate
          if (staleWhileRevalidate && cached.metadata.expiresAt > Date.now() - ttl * 1000 * 2) {
            // Return stale data while revalidating in background
            this.revalidateInBackground(key, ttl, tags)
            return cached.data
          }
        }
      } catch (error) {
        console.warn(`Cache layer ${layer} error:`, error)
        continue
      }
    }

    return null
  }

  static async set<T>(
    key: string,
    data: T,
    options: {
      ttl?: number
      tags?: string[]
      version?: number
      layers?: ('l1' | 'l2' | 'l3' | 'cdn')[]
    } = {}
  ): Promise<void> {
    const {
      ttl = 300,
      tags = [],
      version = 1,
      layers = ['l1', 'l2', 'l3'],
    } = options

    const entry: CacheEntry<T> = {
      data,
      metadata: {
        cachedAt: Date.now(),
        expiresAt: Date.now() + ttl * 1000,
        etag: this.generateETag(data),
        version,
        tags,
      },
    }

    // Set in all specified layers
    const promises = layers.map(layer => this.setInLayer(layer, key, entry, ttl))
    await Promise.allSettled(promises)

    // Invalidate related cache tags
    if (tags.length > 0) {
      await this.invalidateTags(tags)
    }
  }

  static async invalidate(
    pattern: string | RegExp,
    layers: ('l1' | 'l2' | 'l3' | 'cdn')[] = ['l1', 'l2', 'l3']
  ): Promise<void> {
    const promises = layers.map(layer => this.invalidateInLayer(layer, pattern))
    await Promise.allSettled(promises)
  }

  static async invalidateTags(tags: string[]): Promise<void> {
    // Get all keys with these tags
    const tagKeys = tags.map(tag => `tag:${tag}`)
    const { data: keys } = await this.l3Cache.sunion(...tagKeys)

    // Invalidate all tagged keys
    if (keys && keys.length > 0) {
      await Promise.all(
        keys.map(key => this.invalidate(key, ['l1', 'l2', 'l3']))
      )
    }
  }

  // Private helper methods
  private static async getFromLayer<T>(
    layer: string,
    key: string
  ): Promise<CacheEntry<T> | null> {
    switch (layer) {
      case 'l1':
        return this.l1Cache.get(key) || null
      case 'l2':
        return this.l2Cache.get(key) as CacheEntry<T> || null
      case 'l3':
        const cached = await this.l3Cache.get(key)
        return cached ? JSON.parse(cached as string) : null
      case 'cdn':
        return this.cdnCache.get(key) || null
      default:
        return null
    }
  }

  private static async setInLayer(
    layer: string,
    key: string,
    entry: CacheEntry,
    ttl: number
  ): Promise<void> {
    switch (layer) {
      case 'l1':
        this.l1Cache.set(key, entry, { ttl: ttl * 1000 })
        break
      case 'l2':
        this.l2Cache.set(key, entry, ttl)
        break
      case 'l3':
        await this.l3Cache.set(key, JSON.stringify(entry), { ex: ttl })
        break
      case 'cdn':
        this.cdnCache.set(key, entry)
        break
    }
  }

  private static generateETag(data: any): string {
    const str = JSON.stringify(data)
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i)
      hash = hash & hash
    }
    return `"${hash.toString(16)}"`
  }

  private static async revalidateInBackground(
    key: string,
    ttl: number,
    tags: string[]
  ): Promise<void> {
    // Background revalidation logic
    setTimeout(async () => {
      try {
        const freshData = await this.fetchFreshData(key)
        if (freshData) {
          await this.set(key, freshData, { ttl, tags })
        }
      } catch (error) {
        console.warn(`Background revalidation failed for ${key}:`, error)
      }
    }, 0)
  }

  private static promoteToL1(key: string, entry: CacheEntry): void {
    this.l1Cache.set(key, entry)
  }
}
```

### 1.2 Cache Warming & Preloading
**Implementation**:
```typescript
// lib/caching/cache-warmer.ts
export class CacheWarmer {
  private static readonly WARMING_PATTERNS = {
    USER_PROFILE: ['user:{userId}:profile', 'user:{userId}:preferences'],
    PRODUCT_LISTING: ['products:category:{categoryId}', 'products:trending'],
    NAVIGATION_MENU: ['navigation:main', 'navigation:footer'],
  }

  static async warmUserCache(userId: string): Promise<void> {
    const patterns = this.WARMING_PATTERNS.USER_PROFILE.map(pattern =>
      pattern.replace('{userId}', userId)
    )

    await Promise.all(
      patterns.map(pattern => this.warmPattern(pattern))
    )
  }

  static async warmProductCache(categoryId: string): Promise<void> {
    const patterns = this.WARMING_PATTERNS.PRODUCT_LISTING.map(pattern =>
      pattern.replace('{categoryId}', categoryId)
    )

    await Promise.all(
      patterns.map(pattern => this.warmPattern(pattern))
    )
  }

  static async warmNavigationCache(): Promise<void> {
    await Promise.all(
      this.WARMING_PATTERNS.NAVIGATION_MENU.map(pattern => this.warmPattern(pattern))
    )
  }

  private static async warmPattern(pattern: string): Promise<void> {
    try {
      const data = await this.fetchDataForPattern(pattern)
      await MultiLayerCache.set(pattern, data, {
        ttl: 3600, // 1 hour
        tags: ['warmed'],
      })
    } catch (error) {
      console.warn(`Failed to warm cache for pattern ${pattern}:`, error)
    }
  }

  static async scheduleWarming(): Promise<void> {
    // Warm caches daily at 3 AM
    cron.schedule('0 3 * * *', async () => {
      await this.warmNavigationCache()
      await this.warmProductCache('all')
    })

    // Warm user caches on login
    EventEmitter.on('user:login', async (userId: string) => {
      await this.warmUserCache(userId)
    })

    // Warm product caches on view
    EventEmitter.on('product:view', async (categoryId: string) => {
      await this.warmProductCache(categoryId)
    })
  }
}
```

---

## 2. DATABASE OPTIMIZATION

### 2.1 Query Optimization Patterns
```typescript
// lib/database/query-optimizer.ts
export class QueryOptimizer {
  static async optimizedFindUsers(
    filters: {
      role?: string
      status?: string
      dateRange?: { start: Date; end: Date }
      search?: string
      limit?: number
      offset?: number
    },
    options: {
      select?: string[]
      includeRelations?: string[]
      useCache?: boolean
      cacheTtl?: number
    } = {}
  ) {
    const {
      select = ['id', 'email', 'name', 'role', 'status', 'created_at'],
      includeRelations = [],
      useCache = true,
      cacheTtl = 300,
    } = options

    const cacheKey = `users:${JSON.stringify(filters)}:${select.join(',')}`

    // Try cache first
    if (useCache) {
      const cached = await MultiLayerCache.get(cacheKey)
      if (cached) return cached
    }

    // Build optimized query
    let query = supabase
      .from('users')
      .select(select.join(', '))

    // Apply filters with indexes
    if (filters.role) {
      query = query.eq('role', filters.role) // Indexed column
    }

    if (filters.status) {
      query = query.eq('status', filters.status) // Indexed column
    }

    if (filters.dateRange) {
      query = query
        .gte('created_at', filters.dateRange.start.toISOString())
        .lte('created_at', filters.dateRange.end.toISOString())
    }

    if (filters.search) {
      // Use full-text search index
      query = query.textSearch('search_vector', filters.search)
    }

    // Pagination
    if (filters.limit) {
      query = query.limit(filters.limit)
    }

    if (filters.offset) {
      query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1)
    }

    // Include relations if needed
    if (includeRelations.includes('profile')) {
      query = query.select('*, profiles(*)')
    }

    if (includeRelations.includes('orders')) {
      query = query.select('*, orders(*)')
    }

    // Execute query
    const { data, error } = await query

    if (error) {
      throw new DatabaseError('Failed to fetch users', error)
    }

    // Cache results
    if (useCache) {
      await MultiLayerCache.set(cacheKey, data, {
        ttl: cacheTtl,
        tags: ['users', 'user:list'],
      })
    }

    return data
  }

  static async optimizedAggregateQuery(
    table: string,
    aggregates: {
      count?: boolean
      sum?: string[]
      avg?: string[]
      min?: string[]
      max?: string[]
    },
    filters?: Record<string, any>
  ) {
    const cacheKey = `aggregate:${table}:${JSON.stringify(aggregates)}:${JSON.stringify(filters)}`

    // Try cache first
    const cached = await MultiLayerCache.get(cacheKey)
    if (cached) return cached

    let query = supabase.from(table)

    // Build aggregate selections
    const selections = []
    if (aggregates.count) {
      selections.push('count')
    }

    if (aggregates.sum) {
      selections.push(...aggregates.sum.map(col => `sum(${col})`))
    }

    if (aggregates.avg) {
      selections.push(...aggregates.avg.map(col => `avg(${col})`))
    }

    if (aggregates.min) {
      selections.push(...aggregates.min.map(col => `min(${col})`))
    }

    if (aggregates.max) {
      selections.push(...aggregates.max.map(col => `max(${col})`))
    }

    query = query.select(selections.join(', '))

    // Apply filters
    if (filters) {
      Object.entries(filters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          query = query.in(key, value)
        } else {
          query = query.eq(key, value)
        }
      })
    }

    const { data, error } = await query

    if (error) {
      throw new DatabaseError('Failed to execute aggregate query', error)
    }

    // Cache results for 5 minutes
    await MultiLayerCache.set(cacheKey, data, { ttl: 300 })

    return data
  }
}
```

### 2.2 Indexing Strategy
```sql
-- lib/database/indexes.sql
-- Primary indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role_status ON users(role, status);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Composite indexes for common query patterns
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_orders_created_at_amount ON orders(created_at DESC, total_amount);
CREATE INDEX idx_orders_user_created_at ON orders(user_id, created_at DESC);

-- Full-text search indexes
CREATE INDEX idx_users_search_vector ON users USING gin(search_vector);
CREATE INDEX idx_products_search_vector ON products USING gin(search_vector);

-- Partial indexes for frequently queried subsets
CREATE INDEX idx_active_users ON users(id) WHERE status = 'active';
CREATE INDEX idx_pending_orders ON orders(id) WHERE status = 'pending';
CREATE INDEX idx_recent_logs ON audit_logs(timestamp DESC) WHERE timestamp > NOW() - INTERVAL '7 days';

-- Expression indexes
CREATE INDEX idx_users_lower_email ON users(LOWER(email));
CREATE INDEX idx_products_category_lower ON products(LOWER(category));

-- Covering indexes (include frequently accessed columns)
CREATE INDEX idx_users_covering ON users(id, email, name, role, status) INCLUDE (created_at, updated_at);
CREATE INDEX idx_orders_covering ON orders(id, user_id, status) INCLUDE (total_amount, created_at);

-- Foreign key indexes
CREATE INDEX idx_fk_orders_user_id ON orders(user_id);
CREATE INDEX idx_fk_payments_order_id ON payments(order_id);
CREATE INDEX idx_fk_audit_logs_user_id ON audit_logs(user_id);

-- Geospatial indexes (if using PostGIS)
CREATE INDEX idx_locations_geom ON locations USING GIST(geom);

-- BRIN indexes for large timestamp-based tables
CREATE INDEX idx_large_table_created_at ON large_table USING BRIN(created_at);

-- Hash indexes for equality comparisons
CREATE INDEX idx_sessions_token_hash ON sessions USING hash(token);

-- Monitor index usage
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Index maintenance
CREATE OR REPLACE FUNCTION maintain_indexes()
RETURNS void AS $$
BEGIN
    -- Reindex heavily fragmented indexes
    REINDEX INDEX CONCURRENTLY idx_users_email;
    REINDEX INDEX CONCURRENTLY idx_users_role_status;
    
    -- Update statistics
    ANALYZE users;
    ANALYZE orders;
    ANALYZE products;
    
    -- Vacuum if needed
    VACUUM ANALYZE;
END;
$$ LANGUAGE plpgsql;
```

---

## 3. IMAGE OPTIMIZATION

### 3.1 Next.js Image Optimization Pipeline
```typescript
// lib/images/optimization-pipeline.ts
import { getPlaiceholder } from 'plaiceholder'
import sharp from 'sharp'
import { optimize } from 'svgo'

export interface ImageOptimizationOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp' | 'avif' | 'jpeg' | 'png'
  blur?: number
  grayscale?: boolean
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center'
  background?: string
}

export class ImageOptimizer {
  static async optimizeImage(
    buffer: Buffer,
    options: ImageOptimizationOptions = {}
  ): Promise<{
    optimizedBuffer: Buffer
    metadata: {
      format: string
      width: number
      height: number
      size: number
      quality: number
      blurDataURL?: string
    }
  }> {
    const {
      width,
      height,
      quality = 80,
      format = 'webp',
      blur = 0,
      grayscale = false,
      fit = 'cover',
      position = 'center',
      background = 'transparent',
    } = options

    let image = sharp(buffer)

    // Get original metadata
    const metadata = await image.metadata()

    // Apply transformations
    if (width || height) {
      image = image.resize({
        width,
        height,
        fit,
        position,
        background,
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3,
      })
    }

    if (grayscale) {
      image = image.grayscale()
    }

    // Convert to desired format with optimization
    switch (format) {
      case 'webp':
        image = image.webp({
          quality,
          effort: 6, // Maximum compression
          nearLossless: quality >= 90,
          smartSubsample: true,
        })
        break

      case 'avif':
        image = image.avif({
          quality,
          effort: 9, // Maximum compression
          chromaSubsampling: '4:4:4',
        })
        break

      case 'jpeg':
        image = image.jpeg({
          quality,
          mozjpeg: true, // Better compression
          chromaSubsampling: '4:4:4',
        })
        break

      case 'png':
        image = image.png({
          quality,
          compressionLevel: 9, // Maximum compression
          palette: true,
        })
        break
    }

    // Generate optimized buffer
    const optimizedBuffer = await image.toBuffer()

    // Generate blur placeholder if requested
    let blurDataURL: string | undefined
    if (blur > 0) {
      const placeholder = await getPlaiceholder(buffer, { size: blur })
      blurDataURL = placeholder.base64
    }

    // Get optimized metadata
    const optimizedMetadata = await sharp(optimizedBuffer).metadata()

    return {
      optimizedBuffer,
      metadata: {
        format: optimizedMetadata.format!,
        width: optimizedMetadata.width!,
        height: optimizedMetadata.height!,
        size: optimizedBuffer.length,
        quality,
        blurDataURL,
      },
    }
  }

  static async optimizeSVG(svg: string): Promise<string> {
    const optimized = optimize(svg, {
      multipass: true,
      plugins: [
        'removeDoctype',
        'removeXMLProcInst',
        'removeComments',
        'removeMetadata',
        'removeEditorsNSData',
        'cleanupAttrs',
        'mergeStyles',
        'inlineStyles',
        'minifyStyles',
        'cleanupIds',
        'removeUselessDefs',
        'cleanupNumericValues',
        'convertColors',
        'removeUnknownsAndDefaults',
        'removeNonInheritableGroupAttrs',
        'removeUselessStrokeAndFill',
        'cleanupEnableBackground',
        'removeHiddenElems',
        'removeEmptyText',
        'convertShapeToPath',
        'convertEllipseToCircle',
        'moveElemsAttrsToGroup',
        'moveGroupAttrsToElems',
        'collapseGroups',
        'convertPathData',
        'convertTransform',
        'removeEmptyAttrs',
        'removeEmptyContainers',
        'mergePaths',
        'removeUnusedNS',
        'sortAttrs',
        'sortDefsChildren',
        'removeTitle',
        'removeDesc',
        'removeDimensions',
        'removeStyleElement',
        'removeScriptElement',
      ],
    })

    return optimized.data
  }

  static async generateResponsiveImages(
    buffer: Buffer,
    sizes: number[]
  ): Promise<Array<{
    width: number
    height: number
    src: string
    format: string
    size: number
  }>> {
    const results = await Promise.all(
      sizes.map(async (width) => {
        const { optimizedBuffer, metadata } = await this.optimizeImage(buffer, {
          width,
          quality: width <= 640 ? 75 : 85, // Lower quality for smaller images
          format: 'webp',
        })

        return {
          width: metadata.width,
          height: metadata.height,
          src: `data:image/webp;base64,${optimizedBuffer.toString('base64')}`,
          format: metadata.format,
          size: metadata.size,
        }
      })
    )

    return results
  }

  static async generateSrcSet(
    buffer: Buffer,
    sizes: { width: number; media?: string }[]
  ): Promise<{
    srcSet: string
    sizes: string
    fallbackSrc: string
    placeholder?: string
  }> {
    const images = await Promise.all(
      sizes.map(async ({ width }) => {
        const { optimizedBuffer } = await this.optimizeImage(buffer, {
          width,
          format: 'webp',
          quality: width <= 768 ? 75 : width <= 1024 ? 80 : 85,
        })

        return {
          width,
          src: `data:image/webp;base64,${optimizedBuffer.toString('base64')}`,
        }
      })
    )

    // Generate fallback (JPEG for older browsers)
    const { optimizedBuffer: fallbackBuffer } = await this.optimizeImage(buffer, {
      width: Math.max(...sizes.map(s => s.width)),
      format: 'jpeg',
      quality: 85,
    })

    // Generate blur placeholder
    const { base64: placeholder } = await getPlaiceholder(buffer, { size: 10 })

    return {
      srcSet: images.map(img => `${img.src} ${img.width}w`).join(', '),
      sizes: sizes.map(s => s.media ? `(${s.media}) ${s.width}px` : `${s.width}px`).join(', '),
      fallbackSrc: `data:image/jpeg;base64,${fallbackBuffer.toString('base64')}`,
      placeholder,
    }
  }
}
```

### 3.2 Lazy Loading & Placeholders
```typescript
// components/optimized-image.tsx
'use client'

import Image, { ImageProps } from 'next/image'
import { useState, useEffect } from 'react'
import { ImageOptimizer } from '@/lib/images/optimization-pipeline'

interface OptimizedImageProps extends Omit<ImageProps, 'src'> {
  src: string
  sizes?: string
  priority?: boolean
  loading?: 'lazy' | 'eager'
  quality?: number
  blurDataURL?: string
  placeholder?: 'blur' | 'empty'
  optimize?: boolean
}

export default function OptimizedImage({
  src,
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
  priority = false,
  loading = 'lazy',
  quality = 75,
  blurDataURL,
  placeholder = 'blur',
  optimize = true,
  ...props
}: OptimizedImageProps) {
  const [optimizedSrc, setOptimizedSrc] = useState(src)
  const [optimizedBlurDataURL, setOptimizedBlurDataURL] = useState(blurDataURL)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!optimize || !src.startsWith('http')) {
      return
    }

    const optimizeImage = async () => {
      try {
        setIsLoading(true)
        
        // Fetch original image
        const response = await fetch(src)
        const buffer = await response.arrayBuffer()
        
        // Optimize image
        const { optimizedBuffer, metadata } = await ImageOptimizer.optimizeImage(
          Buffer.from(buffer),
          {
            quality,
            format: 'webp',
          }
        )
        
        // Generate blur placeholder
        const { base64: generatedBlurDataURL } = await getPlaiceholder(
          Buffer.from(buffer),
          { size: 10 }
        )
        
        setOptimizedSrc(`data:image/webp;base64,${optimizedBuffer.toString('base64')}`)
        setOptimizedBlurDataURL(generatedBlurDataURL)
      } catch (err) {
        console.error('Failed to optimize image:', err)
        setError(true)
      } finally {
        setIsLoading(false)
      }
    }
    
    optimizeImage()
  }, [src, optimize, quality])

  if (error) {
    return (
      <div className="image-error">
        <Image
          src={src}
          {...props}
          unoptimized={!optimize}
        />
      </div>
    )
  }

  return (
    <div className="optimized-image-container">
      {isLoading && placeholder === 'blur' && optimizedBlurDataURL && (
        <Image
          src={optimizedBlurDataURL}
          {...props}
          fill
          className="blur-placeholder"
          alt=""
          aria-hidden="true"
          unoptimized
        />
      )}
      
      <Image
        src={optimize ? optimizedSrc : src}
        sizes={sizes}
        priority={priority}
        loading={loading}
        quality={quality}
        placeholder={optimizedBlurDataURL ? 'blur' : undefined}
        blurDataURL={optimizedBlurDataURL}
        {...props}
        onLoadingComplete={() => setIsLoading(false)}
        className={`${props.className || ''} ${isLoading ? 'opacity-0' : 'opacity-100 transition-opacity duration-300'}`}
      />
    </div>
  )
}
```

---

## 4. BUNDLE SIZE OPTIMIZATION

### 4.1 Code Splitting & Dynamic Imports
```typescript
// lib/bundle/optimizer.ts
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import { optimize } from 'svgo'

export class BundleOptimizer {
  static async analyzeBundle(buildDir: string): Promise<BundleAnalysis> {
    const report = await BundleAnalyzerPlugin.generateStatsFile(buildDir)
    
    return {
      totalSize: report.totalSize,
      gzippedSize: report.gzippedSize,
      modules: report.modules.map(module => ({
        name: module.name,
        size: module.size,
        gzippedSize: module.gzippedSize,
        percentage: module.percentage,
      })),
      chunks: report.chunks.map(chunk => ({
        name: chunk.name,
        size: chunk.size,
        gzippedSize: chunk.gzippedSize,
        files: chunk.files,
      })),
    }
  }

  static getDynamicImports(): Record<string, () => Promise<any>> {
    return {
      // Heavy libraries
      'react-query': () => import('@tanstack/react-query'),
      'react-hook-form': () => import('react-hook-form'),
      'date-fns': () => import('date-fns'),
      'lodash-es': () => import('lodash-es'),
      
      // UI libraries
      'recharts': () => import('recharts'),
      'react-select': () => import('react-select'),
      'react-modal': () => import('react-modal'),
      
      // Utility libraries
      'axios': () => import('axios'),
      'uuid': () => import('uuid'),
      'crypto-js': () => import('crypto-js'),
      
      // Feature modules
      'pdf-generator': () => import('@/features/pdf-generator'),
      'chart-builder': () => import('@/features/chart-builder'),
      'data-export': () => import('@/features/data-export'),
    }
  }

  static async optimizeSVGAssets(): Promise<void> {
    const svgFiles = await glob('public/**/*.svg')
    
    await Promise.all(
      svgFiles.map(async (file) => {
        const content = await Bun.file(file).text()
        const optimized = optimize(content, {
          multipass: true,
          plugins: [
            'removeDoctype',
            'removeXMLProcInst',
            'removeComments',
            'removeMetadata',
            'removeEditorsNSData',
            'cleanupAttrs',
            'mergeStyles',
            'inlineStyles',
            'minifyStyles',
            'cleanupIds',
            'removeUselessDefs',
            'cleanupNumericValues',
            'convertColors',
            'removeUnknownsAndDefaults',
            'removeNonInheritableGroupAttrs',
            'removeUselessStrokeAndFill',
            'cleanupEnableBackground',
            'removeHiddenElems',
            'removeEmptyText',
            'convertShapeToPath',
            'convertEllipseToCircle',
            'moveElemsAttrsToGroup',
            'moveGroupAttrsToElems',
            'collapseGroups',
            'convertPathData',
            'convertTransform',
            'removeEmptyAttrs',
            'removeEmptyContainers',
            'mergePaths',
            'removeUnusedNS',
            'sortAttrs',
            'sortDefsChildren',
            'removeTitle',
            'removeDesc',
            'removeDimensions',
            'removeStyleElement',
            'removeScriptElement',
          ],
        })
        
        await Bun.write(file, optimized.data)
      })
    )
  }

  static generateBundleReport(): BundleReport {
    const report: BundleReport = {
      timestamp: new Date().toISOString(),
      totalSize: 0,
      gzippedSize: 0,
      modules: [],
      recommendations: [],
    }
    
    // Analyze bundle modules
    const moduleSizes = this.getModuleSizes()
    
    // Generate recommendations
    if (moduleSizes['react-icons'] > 500 * 1024) {
      report.recommendations.push({
        type: 'LIBRARY_REPLACEMENT',
        module: 'react-icons',
        currentSize: moduleSizes['react-icons'],
        recommendation: 'Replace with specific icon imports or use iconify',
        estimatedSavings: '400KB',
      })
    }
    
    if (moduleSizes['lodash'] > 200 * 1024) {
      report.recommendations.push({
        type: 'TREE_SHAKING',
        module: 'lodash',
        currentSize: moduleSizes['lodash'],
        recommendation: 'Use lodash-es and enable tree shaking',
        estimatedSavings: '150KB',
      })
    }
    
    if (moduleSizes['moment'] > 300 * 1024) {
      report.recommendations.push({
        type: 'LIBRARY_REPLACEMENT',
        module: 'moment',
        currentSize: moduleSizes['moment'],
        recommendation: 'Replace with date-fns or dayjs',
        estimatedSavings: '250KB',
      })
    }
    
    return report
  }
}
```

### 4.2 Next.js Bundle Optimization
```javascript
// next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  compress: true,
  
  // Image optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 1 week
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  
  // Experimental features for performance
  experimental: {
    optimizeCss: true,
    scrollRestoration: true,
    workerThreads: true,
    cpus: 4,
    sharedPool: true,
    optimizeServerReact: true,
  },
  
  // Webpack configuration
  webpack: (config, { dev, isServer }) => {
    // Production optimizations
    if (!dev) {
      // Enable tree shaking
      config.optimization = {
        ...config.optimization,
        usedExports: true,
        sideEffects: true,
        concatenateModules: true,
        minimize: true,
        minimizer: [
          (compiler) => {
            const TerserPlugin = require('terser-webpack-plugin')
            new TerserPlugin({
              parallel: true,
              terserOptions: {
                compress: {
                  drop_console: !dev,
                  drop_debugger: !dev,
                },
                mangle: true,
                output: {
                  comments: false,
                },
              },
            }).apply(compiler)
          },
          (compiler) => {
            const CssMinimizerPlugin = require('css-minimizer-webpack-plugin')
            new CssMinimizerPlugin({
              parallel: true,
              minimizerOptions: {
                preset: [
                  'default',
                  {
                    discardComments: { removeAll: true },
                  },
                ],
              },
            }).apply(compiler)
          },
        ],
      }
      
      // Split chunks
      config.optimization.splitChunks = {
        chunks: 'all',
        maxInitialRequests: 25,
        minSize: 20000,
        maxSize: 244000,
        cacheGroups: {
          default: false,
          vendors: {
            test: /[\\/]node_modules[\\/]/,
            priority: -10,
            reuseExistingChunk: true,
            name(module) {
              const packageName = module.context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)[1]
              return `npm.${packageName.replace('@', '')}`
            },
          },
          react: {
            name: 'react',
            test: /[\\/]node_modules[\\/](react|react-dom|react-is|scheduler)[\\/]/,
            priority: 40,
          },
          ui: {
            name: 'ui',
            test: /[\\/]node_modules[\\/](@radix-ui|@headlessui|@tailwindcss|clsx|tailwind-merge)[\\/]/,
            priority: 30,
          },
          forms: {
            name: 'forms',
            test: /[\\/]node_modules[\\/](react-hook-form|@hookform|yup|zod)[\\/]/,
            priority: 20,
          },
          utils: {
            name: 'utils',
            test: /[\\/]node_modules[\\/](date-fns|lodash-es|axios|uuid)[\\/]/,
            priority: 10,
          },
        },
      }
    }
    
    // Module replacements for smaller bundles
    config.resolve = {
      ...config.resolve,
      alias: {
        ...config.resolve.alias,
        'lodash': 'lodash-es',
        'moment': 'dayjs',
        'react-icons': 'react-icons/fa', // Only import FontAwesome
        'chart.js': 'chart.js/dist/chart.min.js',
      },
      fallback: {
        ...config.resolve.fallback,
        crypto: require.resolve('crypto-browserify'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer'),
        util: require.resolve('util'),
      },
    }
    
    return config
  },
  
  // Compiler options
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
    emotion: {
      sourceMap: false,
      autoLabel: 'dev-only',
    },
  },
  
  // Headers for performance
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
          {
            key: 'Content-Encoding',
            value: 'gzip',
          },
        ],
      },
    ]
  },
  
  // Redirects for broken links (performance optimization)
  async redirects() {
    return [
      {
        source: '/old-blog/:slug',
        destination: '/blog/:slug',
        permanent: true,
      },
    ]
  },
  
  // Rewrites for API optimization
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'https://api.example.com/:path*',
      },
    ]
  },
}
```

---

## 5. PERFORMANCE MONITORING

### 5.1 Real User Monitoring (RUM)
```typescript
// lib/monitoring/rum.ts
interface WebVitals {
  CLS: number
  FID: number
  LCP: number
  FCP: number
  TTFB: number
  INP: number
}

interface PerformanceMetric {
  name: string
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  delta: number
  entries: PerformanceEntry[]
  id: string
  navigationType: string
}

export class RealUserMonitoring {
  private static readonly COLLECTION_ENDPOINT = '/api/rum'
  private static readonly SAMPLE_RATE = 0.1 // 10% of users
  private static readonly BUFFER_SIZE = 10
  private static buffer: PerformanceMetric[] = []
  private static isCollecting = false
  
  static init() {
    if (typeof window === 'undefined') return
    
    // Only collect for a sample of users
    if (Math.random() > this.SAMPLE_RATE) return
    
    this.isCollecting = true
    
    // Collect Core Web Vitals
    this.collectWebVitals()
    
    // Collect custom metrics
    this.collectCustomMetrics()
    
    // Collect resource timing
    this.collectResourceTiming()
    
    // Collect navigation timing
    this.collectNavigationTiming()
    
    // Collect memory usage
    this.collectMemoryMetrics()
    
    // Flush buffer periodically
    setInterval(() => this.flushBuffer(), 10000)
    
    // Flush buffer on pagehide
    window.addEventListener('pagehide', () => this.flushBuffer())
  }
  
  private static collectWebVitals() {
    import('web-vitals').then(({ onCLS, onFID, onLCP, onFCP, onTTFB, onINP }) => {
      onCLS(this.handleMetric)
      onFID(this.handleMetric)
      onLCP(this.handleMetric)
      onFCP(this.handleMetric)
      onTTFB(this.handleMetric)
      onINP(this.handleMetric)
    })
  }
  
  private static handleMetric(metric: PerformanceMetric) {
    if (!this.isCollecting) return
    
    this.buffer.push(metric)
    
    if (this.buffer.length >= this.BUFFER_SIZE) {
      this.flushBuffer()
    }
  }
  
  private static collectCustomMetrics() {
    // First Contentful Paint
    const fcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries()
      entries.forEach((entry) => {
        this.handleMetric({
          name: 'FCP',
          value: entry.startTime,
          rating: this.getRating('FCP', entry.startTime),
          delta: entry.startTime,
          entries: [entry],
          id: entry.name,
          navigationType: entry.entryType,
        })
      })
    })
    fcpObserver.observe({ type: 'paint', buffered: true })
    
    // Largest Contentful Paint
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries()
      const lastEntry = entries[entries.length - 1]
      this.handleMetric({
        name: 'LCP',
        value: lastEntry.startTime,
        rating: this.getRating('LCP', lastEntry.startTime),
        delta: lastEntry.startTime,
        entries: [lastEntry],
        id: lastEntry.id,
        navigationType: lastEntry.entryType,
      })
    })
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true })
    
    // Cumulative Layout Shift
    let clsValue = 0
    let clsEntries: PerformanceEntry[] = []
    
    const clsObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value
          clsEntries.push(entry)
        }
      }
    })
    
    clsObserver.observe({ type: 'layout-shift', buffered: true })
    
    // Report CLS on visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.handleMetric({
          name: 'CLS',
          value: clsValue,
          rating: this.getRating('CLS', clsValue),
          delta: clsValue,
          entries: clsEntries,
          id: 'final-cumulative-layout-shift',
          navigationType: 'visibilitychange',
        })
      }
    })
  }
  
  private static collectResourceTiming() {
    const resources = performance.getEntriesByType('resource')
    
    resources.forEach((resource) => {
      this.handleMetric({
        name: 'RESOURCE',
        value: resource.duration,
        rating: this.getRating('RESOURCE', resource.duration),
        delta: resource.duration,
        entries: [resource],
        id: resource.name,
        navigationType: resource.initiatorType,
      })
    })
  }
  
  private static collectNavigationTiming() {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    
    if (navigation) {
      this.handleMetric({
        name: 'NAVIGATION',
        value: navigation.loadEventEnd - navigation.startTime,
        rating: this.getRating('NAVIGATION', navigation.loadEventEnd - navigation.startTime),
        delta: navigation.loadEventEnd - navigation.startTime,
        entries: [navigation],
        id: 'page-navigation',
        navigationType: navigation.type,
      })
    }
  }
  
  private static collectMemoryMetrics() {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      
      this.handleMetric({
        name: 'MEMORY',
        value: memory.usedJSHeapSize,
        rating: this.getRating('MEMORY', memory.usedJSHeapSize),
        delta: memory.usedJSHeapSize,
        entries: [],
        id: 'memory-usage',
        navigationType: 'memory',
      })
    }
  }
  
  private static getRating(metric: string, value: number): 'good' | 'needs-improvement' | 'poor' {
    const thresholds: Record<string, [number, number]> = {
      'FCP': [1000, 2500],
      'LCP': [2500, 4000],
      'FID': [100, 300],
      'CLS': [0.1, 0.25],
      'INP': [200, 500],
      'TTFB': [800, 1800],
    }
    
    const [good, poor] = thresholds[metric] || [0, Infinity]
    
    if (value <= good) return 'good'
    if (value <= poor) return 'needs-improvement'
    return 'poor'
  }
  
  private static async flushBuffer() {
    if (this.buffer.length === 0) return
    
    const metrics = [...this.buffer]
    this.buffer = []
    
    try {
      await fetch(this.COLLECTION_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          metrics,
          userAgent: navigator.userAgent,
          language: navigator.language,
          screenResolution: `${screen.width}x${screen.height}`,
          connection: (navigator as any).connection?.effectiveType || 'unknown',
          deviceMemory: (navigator as any).deviceMemory || 'unknown',
          hardwareConcurrency: navigator.hardwareConcurrency,
          url: window.location.href,
          timestamp: Date.now(),
        }),
        keepalive: true, // Send even if page is unloading
      })
    } catch (error) {
      console.warn('Failed to send RUM data:', error)
    }
  }
}
```

### 5.2 Performance Budgets

```typescript
// lib/monitoring/performance-budgets.ts
interface PerformanceBudget {
  metric: string
  threshold: number
  unit: 'ms' | 'kb' | 'count'
  warning: number
  critical: number
  type: 'core-web-vitals' | 'bundle-size' | 'load-time' | 'resource'
}

interface BudgetCheck {
  name: string
  actual: number
  budget: number
  status: 'passed' | 'warning' | 'failed'
  impact: 'low' | 'medium' | 'high'
  delta: number
  percentage: number
}

export class PerformanceBudgets {
  private static readonly BUDGETS: PerformanceBudget[] = [
    // Core Web Vitals
    { metric: 'LCP', threshold: 2500, unit: 'ms', warning: 2000, critical: 2500, type: 'core-web-vitals' },
    { metric: 'FID', threshold: 100, unit: 'ms', warning: 80, critical: 100, type: 'core-web-vitals' },
    { metric: 'CLS', threshold: 0.1, unit: 'count', warning: 0.08, critical: 0.1, type: 'core-web-vitals' },
    { metric: 'INP', threshold: 200, unit: 'ms', warning: 150, critical: 200, type: 'core-web-vitals' },
    
    // Load times
    { metric: 'TTFB', threshold: 800, unit: 'ms', warning: 600, critical: 800, type: 'load-time' },
    { metric: 'FCP', threshold: 1000, unit: 'ms', warning: 800, critical: 1000, type: 'load-time' },
    { metric: 'DOMContentLoaded', threshold: 2000, unit: 'ms', warning: 1500, critical: 2000, type: 'load-time' },
    { metric: 'Load', threshold: 3000, unit: 'ms', warning: 2500, critical: 3000, type: 'load-time' },
    
    // Bundle size (in kilobytes)
    { metric: 'JS Bundle Size', threshold: 170, unit: 'kb', warning: 150, critical: 170, type: 'bundle-size' },
    { metric: 'CSS Bundle Size', threshold: 50, unit: 'kb', warning: 40, critical: 50, type: 'bundle-size' },
    { metric: 'Total Bundle Size', threshold: 220, unit: 'kb', warning: 200, critical: 220, type: 'bundle-size' },
    { metric: 'Third-party JS', threshold: 100, unit: 'kb', warning: 80, critical: 100, type: 'bundle-size' },
    
    // Resource counts
    { metric: 'HTTP Requests', threshold: 50, unit: 'count', warning: 40, critical: 50, type: 'resource' },
    { metric: 'Image Requests', threshold: 20, unit: 'count', warning: 15, critical: 20, type: 'resource' },
    { metric: 'Font Requests', threshold: 5, unit: 'count', warning: 3, critical: 5, type: 'resource' },
    { metric: 'Script Requests', threshold: 15, unit: 'count', warning: 12, critical: 15, type: 'resource' },
  ]

  static async checkBudgets(): Promise<BudgetCheck[]> {
    const checks: BudgetCheck[] = []
    
    // Collect current performance metrics
    const metrics = await this.collectMetrics()
    
    // Check each budget
    for (const budget of this.BUDGETS) {
      const actual = metrics[budget.metric] || 0
      const status = this.evaluateBudget(budget, actual)
      const delta = actual - budget.threshold
      const percentage = (actual / budget.threshold) * 100
      
      checks.push({
        name: budget.metric,
        actual,
        budget: budget.threshold,
        status,
        impact: this.calculateImpact(budget.type, delta, percentage),
        delta,
        percentage,
      })
    }
    
    return checks
  }

  private static evaluateBudget(budget: PerformanceBudget, actual: number): 'passed' | 'warning' | 'failed' {
    if (actual <= budget.warning) return 'passed'
    if (actual <= budget.critical) return 'warning'
    return 'failed'
  }

  private static calculateImpact(type: string, delta: number, percentage: number): 'low' | 'medium' | 'high' {
    switch (type) {
      case 'core-web-vitals':
        if (percentage > 150) return 'high'
        if (percentage > 125) return 'medium'
        return 'low'
      case 'bundle-size':
        if (percentage > 120) return 'high'
        if (percentage > 110) return 'medium'
        return 'low'
      case 'load-time':
        if (percentage > 200) return 'high'
        if (percentage > 150) return 'medium'
        return 'low'
      case 'resource':
        if (percentage > 200) return 'high'
        if (percentage > 150) return 'medium'
        return 'low'
      default:
        return 'low'
    }
  }

  private static async collectMetrics(): Promise<Record<string, number>> {
    const metrics: Record<string, number> = {}
    
    // Collect Web Vitals
    if (typeof window !== 'undefined') {
      const webVitals = await this.collectWebVitals()
      Object.assign(metrics, webVitals)
    }
    
    // Collect bundle size metrics
    const bundleMetrics = await this.collectBundleMetrics()
    Object.assign(metrics, bundleMetrics)
    
    // Collect resource metrics
    const resourceMetrics = await this.collectResourceMetrics()
    Object.assign(metrics, resourceMetrics)
    
    return metrics
  }

  private static async collectWebVitals(): Promise<Record<string, number>> {
    const metrics: Record<string, number> = {}
    
    if ('webVitals' in window) {
      const webVitals = (window as any).webVitals
      metrics.LCP = webVitals.LCP || 0
      metrics.FID = webVitals.FID || 0
      metrics.CLS = webVitals.CLS || 0
      metrics.INP = webVitals.INP || 0
      metrics.FCP = webVitals.FCP || 0
      metrics.TTFB = webVitals.TTFB || 0
    }
    
    return metrics
  }

  private static async collectBundleMetrics(): Promise<Record<string, number>> {
    const metrics: Record<string, number> = {}
    
    // Calculate bundle sizes from performance entries
    const resources = performance.getEntriesByType('resource')
    let totalJS = 0
    let totalCSS = 0
    let thirdPartyJS = 0
    let scriptCount = 0
    
    resources.forEach(resource => {
      const url = resource.name
      const size = (resource as any).transferSize || 0
      
      if (url.endsWith('.js')) {
        totalJS += size
        scriptCount++
        
        // Check if third-party
        if (!url.includes(window.location.origin)) {
          thirdPartyJS += size
        }
      } else if (url.endsWith('.css')) {
        totalCSS += size
      }
    })
    
    // Convert bytes to kilobytes
    metrics['JS Bundle Size'] = Math.round(totalJS / 1024)
    metrics['CSS Bundle Size'] = Math.round(totalCSS / 1024)
    metrics['Total Bundle Size'] = metrics['JS Bundle Size'] + metrics['CSS Bundle Size']
    metrics['Third-party JS'] = Math.round(thirdPartyJS / 1024)
    metrics['Script Requests'] = scriptCount
    
    return metrics
  }

  private static async collectResourceMetrics(): Promise<Record<string, number>> {
    const metrics: Record<string, number> = {}
    
    const resources = performance.getEntriesByType('resource')
    let imageCount = 0
    let fontCount = 0
    let totalRequests = resources.length
    
    resources.forEach(resource => {
      const url = resource.name
      if (url.match(/\.(jpg|jpeg|png|gif|webp|avif)$/i)) {
        imageCount++
      } else if (url.match(/\.(woff|woff2|ttf|otf|eot)$/i)) {
        fontCount++
      }
    })
    
    metrics['HTTP Requests'] = totalRequests
    metrics['Image Requests'] = imageCount
    metrics['Font Requests'] = fontCount
    
    return metrics
  }

  static async generateBudgetReport(): Promise<string> {
    const checks = await this.checkBudgets()
    const passed = checks.filter(c => c.status === 'passed').length
    const warnings = checks.filter(c => c.status === 'warning').length
    const failed = checks.filter(c => c.status === 'failed').length
    
    const report = `
# PERFORMANCE BUDGET REPORT
Generated: ${new Date().toISOString()}

## SUMMARY
- Total Checks: ${checks.length}
- ✅ Passed: ${passed} (${Math.round((passed / checks.length) * 100)}%)
- ⚠️ Warnings: ${warnings} (${Math.round((warnings / checks.length) * 100)}%)
- ❌ Failed: ${failed} (${Math.round((failed / checks.length) * 100)}%)

## DETAILED RESULTS

${checks.map(check => `
### ${check.name}
- **Actual**: ${check.actual} ${this.BUDGETS.find(b => b.metric === check.name)?.unit}
- **Budget**: ${check.budget} ${this.BUDGETS.find(b => b.metric === check.name)?.unit}
- **Status**: ${check.status === 'passed' ? '✅ Passed' : check.status === 'warning' ? '⚠️ Warning' : '❌ Failed'}
- **Impact**: ${check.impact.toUpperCase()}
- **Delta**: ${check.delta >= 0 ? '+' : ''}${check.delta} (${check.percentage.toFixed(1)}%)
`).join('\n')}

## RECOMMENDATIONS
${this.generateRecommendations(checks)}

## NEXT STEPS
1. Address critical failures immediately
2. Investigate warnings within 7 days
3. Schedule performance review meeting
4. Update budgets based on new metrics
    `
    
    return report
  }

  private static generateRecommendations(checks: BudgetCheck[]): string {
    const recommendations: string[] = []
    
    checks.forEach(check => {
      if (check.status === 'failed') {
        const budget = this.BUDGETS.find(b => b.metric === check.name)
        if (budget) {
          switch (budget.type) {
            case 'core-web-vitals':
              recommendations.push(`**${check.name}**: Reduce by ${Math.abs(check.delta)}${budget.unit} to meet budget`)
              break
            case 'bundle-size':
              recommendations.push(`**${check.name}**: Reduce bundle size by ${Math.abs(check.delta)}${budget.unit} (${check.percentage.toFixed(1)}% over budget)`)
              break
            case 'load-time':
              recommendations.push(`**${check.name}**: Optimize loading by ${Math.abs(check.delta)}${budget.unit}`)
              break
            case 'resource':
              recommendations.push(`**${check.name}**: Reduce number of requests by ${Math.abs(check.delta)}`)
              break
          }
        }
      }
    })
    
    return recommendations.length > 0 
      ? recommendations.map(r => `- ${r}`).join('\n')
      : 'All budgets are within acceptable ranges.'
  }
}
```

### 5.3 Automated Performance Testing
```typescript
// lib/testing/performance-tests.ts
import { chromium, devices } from 'playwright'
import lighthouse from 'lighthouse'
import * as chromeLauncher from 'chrome-launcher'

interface PerformanceTestResult {
  url: string
  timestamp: string
  metrics: {
    performance: number
    accessibility: number
    bestPractices: number
    seo: number
    pwa: number
  }
  audits: Record<string, any>
  recommendations: string[]
}

export class PerformanceTester {
  static async runLighthouseTest(url: string, options: {
    device?: keyof typeof devices
    throttling?: 'none' | 'slow4g' | 'fast3g'
    runs?: number
  } = {}): Promise<PerformanceTestResult> {
    const {
      device = 'Desktop Chrome',
      throttling = 'none',
      runs = 3,
    } = options

    const results: PerformanceTestResult[] = []
    
    for (let i = 0; i < runs; i++) {
      const result = await this.runSingleTest(url, device, throttling)
      results.push(result)
    }

    // Calculate average scores
    const averageResult = this.calculateAverageResults(results)
    
    return averageResult
  }

  private static async runSingleTest(
    url: string,
    device: keyof typeof devices,
    throttling: string
  ): Promise<PerformanceTestResult> {
    // Launch Chrome
    const chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox'],
    })

    try {
      // Run Lighthouse
      const runnerResult = await lighthouse(url, {
        port: chrome.port,
        output: 'json',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo', 'pwa'],
        throttling: this.getThrottlingConfig(throttling),
        screenEmulation: this.getScreenEmulation(device),
      })

      // Parse results
      const lhr = runnerResult!.lhr
      
      return {
        url,
        timestamp: new Date().toISOString(),
        metrics: {
          performance: Math.round(lhr.categories.performance.score * 100),
          accessibility: Math.round(lhr.categories.accessibility.score * 100),
          bestPractices: Math.round(lhr.categories['best-practices'].score * 100),
          seo: Math.round(lhr.categories.seo.score * 100),
          pwa: Math.round(lhr.categories.pwa.score * 100),
        },
        audits: Object.entries(lhr.audits).reduce((acc, [key, audit]) => ({
          ...acc,
          [key]: {
            score: audit.score,
            displayValue: audit.displayValue,
            description: audit.description,
          },
        }), {}),
        recommendations: this.generateRecommendations(lhr),
      }
    } finally {
      await chrome.kill()
    }
  }

  static async runPlaywrightPerformanceTest(url: string): Promise<{
    navigationTiming: any
    resourceTiming: any
    paintTiming: any
    memoryUsage: any
  }> {
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      // Enable performance monitoring
      await page.route('**/*', (route) => {
        route.continue()
      })

      // Navigate to page
      const response = await page.goto(url, { waitUntil: 'networkidle' })

      if (!response) {
        throw new Error(`Failed to load ${url}`)
      }

      // Collect performance metrics
      const navigationTiming = await page.evaluate(() => 
        JSON.parse(JSON.stringify(performance.getEntriesByType('navigation')[0]))
      )

      const resourceTiming = await page.evaluate(() => 
        JSON.parse(JSON.stringify(performance.getEntriesByType('resource')))
      )

      const paintTiming = await page.evaluate(() => {
        const paints = performance.getEntriesByType('paint')
        return {
          fcp: paints.find(p => p.name === 'first-contentful-paint'),
          fp: paints.find(p => p.name === 'first-paint'),
        }
      })

      const memoryUsage = await page.evaluate(() => {
        if ('memory' in performance) {
          return (performance as any).memory
        }
        return null
      })

      // Capture screenshots at different stages
      await page.screenshot({ path: 'screenshots/initial-load.png', fullPage: true })
      
      // Simulate user interaction
      await page.waitForTimeout(1000)
      await page.screenshot({ path: 'screenshots/after-interaction.png', fullPage: true })

      return {
        navigationTiming,
        resourceTiming,
        paintTiming,
        memoryUsage,
      }
    } finally {
      await browser.close()
    }
  }

  static async runLoadTest(
    url: string,
    concurrentUsers: number,
    durationSeconds: number
  ): Promise<LoadTestResult> {
    const results: RequestResult[] = []
    const startTime = Date.now()
    const endTime = startTime + (durationSeconds * 1000)

    // Simulate concurrent users
    const userPromises = Array.from({ length: concurrentUsers }, (_, i) =>
      this.simulateUser(url, i, startTime, endTime)
    )

    const userResults = await Promise.all(userPromises)
    results.push(...userResults.flat())

    // Calculate statistics
    const responseTimes = results.map(r => r.responseTime)
    const successRate = (results.filter(r => r.success).length / results.length) * 100
    const errorRate = 100 - successRate

    return {
      totalRequests: results.length,
      concurrentUsers,
      durationSeconds,
      avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      p95ResponseTime: this.calculatePercentile(responseTimes, 95),
      p99ResponseTime: this.calculatePercentile(responseTimes, 99),
      successRate,
      errorRate,
      errors: results.filter(r => !r.success).map(r => r.error),
      timestamp: new Date().toISOString(),
    }
  }

  private static async simulateUser(
    url: string,
    userId: number,
    startTime: number,
    endTime: number
  ): Promise<RequestResult[]> {
    const results: RequestResult[] = []
    const browser = await chromium.launch()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      while (Date.now() < endTime) {
        const start = Date.now()
        
        try {
          await page.goto(url, { waitUntil: 'networkidle' })
          
          // Simulate user interactions
          await this.simulateUserJourney(page)
          
          results.push({
            userId,
            success: true,
            responseTime: Date.now() - start,
            timestamp: new Date().toISOString(),
          })
        } catch (error) {
          results.push({
            userId,
            success: false,
            responseTime: Date.now() - start,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        }

        // Wait random interval between requests
        await page.waitForTimeout(Math.random() * 5000 + 1000)
      }
    } finally {
      await browser.close()
    }

    return results
  }

  private static async simulateUserJourney(page: any): Promise<void> {
    // Click on random links
    const links = await page.$$('a')
    if (links.length > 0) {
      const randomLink = links[Math.floor(Math.random() * links.length)]
      await randomLink.click()
      await page.waitForLoadState('networkidle')
    }

    // Fill out forms
    const forms = await page.$$('form')
    if (forms.length > 0) {
      const inputs = await page.$$('input, textarea, select')
      for (const input of inputs.slice(0, 3)) { // Fill first 3 inputs
        const inputType = await input.getAttribute('type')
        if (inputType === 'text' || inputType === 'email' || !inputType) {
          await input.fill('test@example.com')
        } else if (inputType === 'checkbox' || inputType === 'radio') {
          await input.click()
        }
      }
    }

    // Scroll the page
    await page.evaluate(() => {
      window.scrollTo(0, Math.random() * document.body.scrollHeight)
    })

    await page.waitForTimeout(1000)
  }

  static generatePerformanceReport(testResults: {
    lighthouse: PerformanceTestResult
    playwright: any
    loadTest: LoadTestResult
  }): string {
    return `
# PERFORMANCE TEST REPORT
Generated: ${new Date().toISOString()}

## LIGHTHOUSE SCORES
- Performance: ${testResults.lighthouse.metrics.performance}/100
- Accessibility: ${testResults.lighthouse.metrics.accessibility}/100
- Best Practices: ${testResults.lighthouse.metrics.bestPractices}/100
- SEO: ${testResults.lighthouse.metrics.seo}/100
- PWA: ${testResults.lighthouse.metrics.pwa}/100

## LOAD TEST RESULTS
- Concurrent Users: ${testResults.loadTest.concurrentUsers}
- Total Requests: ${testResults.loadTest.totalRequests}
- Average Response Time: ${testResults.loadTest.avgResponseTime.toFixed(2)}ms
- P95 Response Time: ${testResults.loadTest.p95ResponseTime.toFixed(2)}ms
- P99 Response Time: ${testResults.loadTest.p99ResponseTime.toFixed(2)}ms
- Success Rate: ${testResults.loadTest.successRate.toFixed(1)}%
- Error Rate: ${testResults.loadTest.errorRate.toFixed(1)}%

## PLAYWRIGHT METRICS
- Navigation Timing: ${JSON.stringify(testResults.playwright.navigationTiming, null, 2)}
- Resource Count: ${testResults.playwright.resourceTiming?.length || 0}
- First Contentful Paint: ${testResults.playwright.paintTiming?.fcp?.startTime || 'N/A'}ms
- First Paint: ${testResults.playwright.paintTiming?.fp?.startTime || 'N/A'}ms

## RECOMMENDATIONS
${testResults.lighthouse.recommendations.map(r => `- ${r}`).join('\n')}

## ACTION ITEMS
1. ${testResults.lighthouse.metrics.performance < 90 ? 'Optimize Core Web Vitals' : 'Performance is good'}
2. ${testResults.lighthouse.metrics.accessibility < 90 ? 'Fix accessibility issues' : 'Accessibility is good'}
3. ${testResults.loadTest.successRate < 99 ? 'Improve error handling and retry logic' : 'Error rate is acceptable'}
4. ${testResults.loadTest.p95ResponseTime > 1000 ? 'Optimize backend response times' : 'Response times are good'}
    `
  }
}
```

---

## 6. PERFORMANCE MONITORING DASHBOARD

### 6.1 Real-time Dashboard Implementation
```typescript
// components/dashboard/performance-dashboard.tsx
'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts'

interface PerformanceMetrics {
  timestamp: string
  lcp: number
  fid: number
  cls: number
  inp: number
  ttfb: number
  fcp: number
  domLoaded: number
  load: number
}

interface BundleMetrics {
  timestamp: string
  jsSize: number
  cssSize: number
  totalSize: number
  thirdPartySize: number
}

interface ResourceMetrics {
  timestamp: string
  requests: number
  images: number
  scripts: number
  fonts: number
}

export default function PerformanceDashboard() {
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([])
  const [bundleMetrics, setBundleMetrics] = useState<BundleMetrics[]>([])
  const [resourceMetrics, setResourceMetrics] = useState<ResourceMetrics[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h')

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [timeRange])

  const fetchMetrics = async () => {
    try {
      const [performanceRes, bundleRes, resourceRes, alertsRes] = await Promise.all([
        fetch(`/api/metrics/performance?range=${timeRange}`),
        fetch(`/api/metrics/bundle?range=${timeRange}`),
        fetch(`/api/metrics/resources?range=${timeRange}`),
        fetch(`/api/metrics/alerts?range=${timeRange}`),
      ])

      const [performanceData, bundleData, resourceData, alertsData] = await Promise.all([
        performanceRes.json(),
        bundleRes.json(),
        resourceRes.json(),
        alertsRes.json(),
      ])

      setMetrics(performanceData)
      setBundleMetrics(bundleData)
      setResourceMetrics(resourceData)
      setAlerts(alertsData)
    } catch (error) {
      console.error('Failed to fetch metrics:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateScore = (value: number, threshold: number): number => {
    return Math.max(0, Math.min(100, (threshold / value) * 100))
  }

  const getStatusColor = (score: number): string => {
    if (score >= 90) return '#10b981' // green
    if (score >= 70) return '#f59e0b' // yellow
    return '#ef4444' // red
  }

  const performanceScore = metrics.length > 0 
    ? Math.round(
        (calculateScore(metrics[metrics.length - 1].lcp, 2500) +
         calculateScore(metrics[metrics.length - 1].fid, 100) +
         calculateScore(metrics[metrics.length - 1].cls * 1000, 100)) / 3
      )
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Performance Dashboard</h1>
          <p className="text-gray-600">Real-time performance monitoring and analytics</p>
        </div>
        <div className="flex items-center space-x-4">
          <Tabs value={timeRange} onValueChange={(v) => setTimeRange(v as any)}>
            <TabsList>
              <TabsTrigger value="1h">1 Hour</TabsTrigger>
              <TabsTrigger value="24h">24 Hours</TabsTrigger>
              <TabsTrigger value="7d">7 Days</TabsTrigger>
              <TabsTrigger value="30d">30 Days</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button onClick={fetchMetrics} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Performance Alerts</AlertTitle>
          <AlertDescription>
            {alerts.length} performance issue{alerts.length > 1 ? 's' : ''} detected
          </AlertDescription>
        </Alert>
      )}

      {/* Performance Score */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Score</CardTitle>
          <CardDescription>
            Overall performance score based on Core Web Vitals
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div className="relative h-32 w-32">
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-4xl font-bold" style={{ color: getStatusColor(performanceScore) }}>
                  {performanceScore}
                </span>
              </div>
              <svg className="h-32 w-32" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  stroke="#e5e7eb"
                  strokeWidth="10"
                  fill="none"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  stroke={getStatusColor(performanceScore)}
                  strokeWidth="10"
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`\${(performanceScore / 100) * 283} 283`}
                  transform="rotate(-90 50 50)"
                />
              </svg>
            </div>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 rounded-full bg-green-500"></div>
                <span>LCP: {metrics[metrics.length - 1]?.lcp || 0}ms</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 rounded-full bg-yellow-500"></div>
                <span>FID: {metrics[metrics.length - 1]?.fid || 0}ms</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="h-3 w-3 rounded-full bg-red-500"></div>
                <span>CLS: {metrics[metrics.length - 1]?.cls || 0}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Core Web Vitals Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Core Web Vitals Trend</CardTitle>
            <CardDescription>Last 24 hours performance</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={metrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="timestamp" 
                  tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value) => [`${value}ms`, 'Value']}
                />
                <Legend />
                <Line type="monotone" dataKey="lcp" stroke="#3b82f6" name="LCP" />
                <Line type="monotone" dataKey="fid" stroke="#10b981" name="FID" />
                <Line type="monotone" dataKey="cls" stroke="#8b5cf6" name="CLS" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Bundle Size Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Bundle Size Trend</CardTitle>
            <CardDescription>JavaScript and CSS bundle sizes</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bundleMetrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="timestamp"
                  tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                />
                <YAxis />
                <Tooltip 
                  labelFormatter={(value) => new Date(value).toLocaleString()}
                  formatter={(value) => [`${value}KB`, 'Size']}
                />
                <Legend />
                <Bar dataKey="jsSize" fill="#3b82f6" name="JS Size" />
                <Bar dataKey="cssSize" fill="#10b981" name="CSS Size" />
                <Bar dataKey="thirdPartySize" fill="#8b5cf6" name="Third Party" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Resource Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Resource Distribution</CardTitle>
            <CardDescription>Breakdown of HTTP requests</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={[
                    { name: 'Images', value: resourceMetrics[resourceMetrics.length - 1]?.images || 0 },
                    { name: 'Scripts', value: resourceMetrics[resourceMetrics.length - 1]?.scripts || 0 },
                    { name: 'Fonts', value: resourceMetrics[resourceMetrics.length - 1]?.fonts || 0 },
                    { name: 'Other', value: (resourceMetrics[resourceMetrics.length - 1]?.requests || 0) - 
                      (resourceMetrics[resourceMetrics.length - 1]?.images || 0) - 
                      (resourceMetrics[resourceMetrics.length - 1]?.scripts || 0) - 
                      (resourceMetrics[resourceMetrics.length - 1]?.fonts || 0)
                    },
                  ]}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  <Cell fill="#3b82f6" />
                  <Cell fill="#10b981" />
                  <Cell fill="#8b5cf6" />
                  <Cell fill="#f59e0b" />
                </Pie>
                <Tooltip formatter={(value) => [`\${value} requests`, 'Count']} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

                      {/* Performance Alerts */}
              {alerts.slice(0, 5).map((alert: any, index: number) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className={`h-3 w-3 rounded-full ${
                      alert.severity === 'critical' ? 'bg-red-500' :
                      alert.severity === 'warning' ? 'bg-yellow-500' :
                      'bg-blue-500'
                    }`}></div>
                    <div>
                      <p className="font-medium">{alert.title}</p>
                      <p className="text-sm text-gray-600">{alert.description}</p>
                    </div>
                  </div>
                  <Badge variant={
                    alert.severity === 'critical' ? 'destructive' :
                    alert.severity === 'warning' ? 'secondary' :
                    'default'
                  }>
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Metrics Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Metrics</CardTitle>
          <CardDescription>All performance metrics for the selected time range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-4">Metric</th>
                  <th className="text-left py-2 px-4">Current</th>
                  <th className="text-left py-2 px-4">Average</th>
                  <th className="text-left py-2 px-4">Min</th>
                  <th className="text-left py-2 px-4">Max</th>
                  <th className="text-left py-2 px-4">Trend</th>
                  <th className="text-left py-2 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'LCP', current: metrics[metrics.length - 1]?.lcp || 0, unit: 'ms', threshold: 2500 },
                  { name: 'FID', current: metrics[metrics.length - 1]?.fid || 0, unit: 'ms', threshold: 100 },
                  { name: 'CLS', current: metrics[metrics.length - 1]?.cls || 0, unit: '', threshold: 0.1 },
                  { name: 'INP', current: metrics[metrics.length - 1]?.inp || 0, unit: 'ms', threshold: 200 },
                  { name: 'TTFB', current: metrics[metrics.length - 1]?.ttfb || 0, unit: 'ms', threshold: 800 },
                  { name: 'FCP', current: metrics[metrics.length - 1]?.fcp || 0, unit: 'ms', threshold: 1000 },
                  { name: 'DOM Loaded', current: metrics[metrics.length - 1]?.domLoaded || 0, unit: 'ms', threshold: 2000 },
                  { name: 'Page Load', current: metrics[metrics.length - 1]?.load || 0, unit: 'ms', threshold: 3000 },
                ].map((metric, index) => {
                  const values = metrics.map(m => m[metric.name.toLowerCase().replace(' ', '')] || 0)
                  const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
                  const min = Math.min(...values)
                  const max = Math.max(...values)
                  const trend = values.length > 1 ? values[values.length - 1] - values[0] : 0
                  const status = metric.current <= metric.threshold * 0.8 ? 'good' : 
                                metric.current <= metric.threshold ? 'warning' : 'poor'
                  
                  return (
                    <tr key={index} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4 font-medium">{metric.name}</td>
                      <td className="py-2 px-4">{metric.current.toFixed(2)}{metric.unit}</td>
                      <td className="py-2 px-4">{avg.toFixed(2)}{metric.unit}</td>
                      <td className="py-2 px-4">{min.toFixed(2)}{metric.unit}</td>
                      <td className="py-2 px-4">{max.toFixed(2)}{metric.unit}</td>
                      <td className="py-2 px-4">
                        <div className="flex items-center">
                          <span className={`mr-2 ${trend < 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {trend >= 0 ? '↑' : '↓'}
                          </span>
                          <span>{Math.abs(trend).toFixed(2)}{metric.unit}</span>
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        <Badge variant={
                          status === 'good' ? 'success' :
                          status === 'warning' ? 'secondary' :
                          'destructive'
                        }>
                          {status}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Actionable Insights */}
      <Card>
        <CardHeader>
          <CardTitle>Actionable Insights</CardTitle>
          <CardDescription>Recommended optimizations based on current metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {this.generateInsights(metrics[metrics.length - 1], bundleMetrics[bundleMetrics.length - 1], resourceMetrics[resourceMetrics.length - 1]).map((insight, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 border rounded-lg">
                <div className={`p-2 rounded-full ${
                  insight.priority === 'high' ? 'bg-red-100 text-red-600' :
                  insight.priority === 'medium' ? 'bg-yellow-100 text-yellow-600' :
                  'bg-blue-100 text-blue-600'
                }`}>
                  {insight.priority === 'high' ? '⚠️' : insight.priority === 'medium' ? '🔧' : '💡'}
                </div>
                <div className="flex-1">
                  <h4 className="font-medium">{insight.title}</h4>
                  <p className="text-sm text-gray-600">{insight.description}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-medium">Impact: {insight.impact}</span>
                    <span className="text-sm text-gray-500">Effort: {insight.effort}</span>
                  </div>
                </div>
                <Button size="sm">{insight.action}</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )

  private static generateInsights(performance: any, bundle: any, resources: any): Array<{
    title: string
    description: string
    priority: 'high' | 'medium' | 'low'
    impact: 'high' | 'medium' | 'low'
    effort: 'low' | 'medium' | 'high'
    action: string
  }> {
    const insights: Array<{
      title: string
      description: string
      priority: 'high' | 'medium' | 'low'
      impact: 'high' | 'medium' | 'low'
      effort: 'low' | 'medium' | 'high'
      action: string
    }> = []

    // LCP insights
    if (performance?.lcp > 2500) {
      insights.push({
        title: 'Optimize Largest Contentful Paint',
        description: 'LCP is above the recommended threshold of 2.5s. Consider optimizing images, implementing lazy loading, and preloading critical resources.',
        priority: 'high',
        impact: 'high',
        effort: 'medium',
        action: 'Optimize',
      })
    }

    // CLS insights
    if (performance?.cls > 0.1) {
      insights.push({
        title: 'Reduce Cumulative Layout Shift',
        description: 'CLS is above 0.1. Ensure images have dimensions, ads are reserved space, and fonts are preloaded.',
        priority: 'high',
        impact: 'high',
        effort: 'low',
        action: 'Fix Layout',
      })
    }

    // Bundle size insights
    if (bundle?.totalSize > 220) {
      insights.push({
        title: 'Reduce Bundle Size',
        description: `Total bundle size is ${bundle.totalSize}KB, exceeding the 220KB budget. Consider code splitting, tree shaking, and lazy loading.`,
        priority: 'medium',
        impact: 'high',
        effort: 'medium',
        action: 'Analyze',
      })
    }

    // Third-party insights
    if (bundle?.thirdPartySize > 100) {
      insights.push({
        title: 'Optimize Third-Party Scripts',
        description: `Third-party scripts account for ${bundle.thirdPartySize}KB. Consider lazy loading non-critical scripts and using lighter alternatives.`,
        priority: 'medium',
        impact: 'medium',
        effort: 'medium',
        action: 'Review',
      })
    }

    // Resource count insights
    if (resources?.requests > 50) {
      insights.push({
        title: 'Reduce HTTP Requests',
        description: `Page makes ${resources.requests} requests. Consider combining files, using sprites, and implementing HTTP/2 multiplexing.`,
        priority: 'low',
        impact: 'medium',
        effort: 'high',
        action: 'Combine',
      })
    }

    return insights
  }
}
```

### 6.2 API Routes for Dashboard
```typescript
// app/api/metrics/performance/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '24h'
    
    let startDate = new Date()
    switch (range) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1)
        break
      case '24h':
        startDate.setDate(startDate.getDate() - 1)
        break
      case '7d':
        startDate.setDate(startDate.getDate() - 7)
        break
      case '30d':
        startDate.setDate(startDate.getDate() - 30)
        break
    }

    const { data, error } = await supabase
      .from('performance_metrics')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true })

    if (error) {
      throw error
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch performance metrics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch performance metrics' },
      { status: 500 }
    )
  }
}

// app/api/metrics/bundle/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '24h'
    
    let startDate = new Date()
    switch (range) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1)
        break
      case '24h':
        startDate.setDate(startDate.getDate() - 1)
        break
      case '7d':
        startDate.setDate(startDate.getDate() - 7)
        break
      case '30d':
        startDate.setDate(startDate.getDate() - 30)
        break
    }

    const { data, error } = await supabase
      .from('bundle_metrics')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true })

    if (error) {
      throw error
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch bundle metrics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch bundle metrics' },
      { status: 500 }
    )
  }
}

// app/api/metrics/resources/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '24h'
    
    let startDate = new Date()
    switch (range) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1)
        break
      case '24h':
        startDate.setDate(startDate.getDate() - 1)
        break
      case '7d':
        startDate.setDate(startDate.getDate() - 7)
        break
      case '30d':
        startDate.setDate(startDate.getDate() - 30)
        break
    }

    const { data, error } = await supabase
      .from('resource_metrics')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true })

    if (error) {
      throw error
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch resource metrics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch resource metrics' },
      { status: 500 }
    )
  }
}

// app/api/metrics/alerts/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get('range') || '24h'
    
    let startDate = new Date()
    switch (range) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1)
        break
      case '24h':
        startDate.setDate(startDate.getDate() - 1)
        break
      case '7d':
        startDate.setDate(startDate.getDate() - 7)
        break
      case '30d':
        startDate.setDate(startDate.getDate() - 30)
        break
    }

    const { data, error } = await supabase
      .from('performance_alerts')
      .select('*')
      .gte('created_at', startDate.toISOString())
      .eq('resolved', false)
      .order('severity', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    if (error) {
      throw error
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch performance alerts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch performance alerts' },
      { status: 500 }
    )
  }
}

// app/api/metrics/collect/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { metrics, userAgent, language, screenResolution, connection, deviceMemory, hardwareConcurrency, url } = body

    // Store metrics in database
    const { error } = await supabase.from('performance_metrics').insert([
      {
        lcp: metrics.LCP || 0,
        fid: metrics.FID || 0,
        cls: metrics.CLS || 0,
        inp: metrics.INP || 0,
        ttfb: metrics.TTFB || 0,
        fcp: metrics.FCP || 0,
        dom_loaded: metrics.DOMContentLoaded || 0,
        load: metrics.Load || 0,
        user_agent: userAgent,
        language,
        screen_resolution: screenResolution,
        connection,
        device_memory: deviceMemory,
        hardware_concurrency: hardwareConcurrency,
        url,
        created_at: new Date().toISOString(),
      },
    ])

    if (error) {
      throw error
    }

    // Check for performance alerts
    await checkPerformanceAlerts(metrics)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to collect performance metrics:', error)
    return NextResponse.json(
      { error: 'Failed to collect performance metrics' },
      { status: 500 }
    )
  }
}

async function checkPerformanceAlerts(metrics: any) {
  const alerts = []

  if (metrics.LCP > 4000) {
    alerts.push({
      title: 'Critical LCP Detected',
      description: `LCP of ${metrics.LCP}ms exceeds critical threshold of 4000ms`,
      severity: 'critical',
      metric: 'LCP',
      value: metrics.LCP,
      threshold: 4000,
      url: metrics.url,
    })
  }

  if (metrics.CLS > 0.25) {
    alerts.push({
      title: 'Critical CLS Detected',
      description: `CLS of ${metrics.CLS} exceeds critical threshold of 0.25`,
      severity: 'critical',
      metric: 'CLS',
      value: metrics.CLS,
      threshold: 0.25,
      url: metrics.url,
    })
  }

  if (metrics.FID > 300) {
    alerts.push({
      title: 'Critical FID Detected',
      description: `FID of ${metrics.FID}ms exceeds critical threshold of 300ms`,
      severity: 'critical',
      metric: 'FID',
      value: metrics.FID,
      threshold: 300,
      url: metrics.url,
    })
  }

  if (alerts.length > 0) {
    await supabase.from('performance_alerts').insert(
      alerts.map(alert => ({
        ...alert,
        created_at: new Date().toISOString(),
        resolved: false,
      }))
    )
  }
}
```

---

## 7. CONTINUOUS PERFORMANCE MONITORING

### 7.1 GitHub Actions Performance Workflow
```yaml

# .github/workflows/performance.yml
name: Performance Monitoring

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 0 * * *' # Daily at midnight
  workflow_dispatch:

jobs:
  performance-test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: npm run build
        env:
          NEXT_PUBLIC_APP_URL: ${{ secrets.NEXT_PUBLIC_APP_URL }}

      - name: Run Lighthouse tests
        uses: treosh/lighthouse-ci-action@v10
        with:
          configPath: './lighthouserc.json'
          uploadArtifacts: true
          temporaryPublicStorage: true
          runs: 3
          staticDistDir: .next

      - name: Run Playwright performance tests
        run: npx playwright test performance.spec.ts

      - name: Run bundle analysis
        run: |
          npm run build -- --analyze
          cp .next/analyze/client.html bundle-analysis.html

      - name: Upload bundle analysis
        uses: actions/upload-artifact@v3
        with:
          name: bundle-analysis
          path: bundle-analysis.html

      - name: Check performance budgets
        run: npx webpack-bundle-analyzer .next/stats.json --mode static --report bundle-report.html
        continue-on-error: true

      - name: Upload performance report
        uses: actions/upload-artifact@v3
        with:
          name: performance-report
          path: |
            .lighthouseci/
            bundle-report.html
            playwright-report/

      - name: Send performance alerts
        if: failure()
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          channel: '#performance-alerts'
          author_name: Performance Bot
          fields: repo,message,commit,author,action
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}

  performance-degradation-check:
    runs-on: ubuntu-latest
    needs: performance-test
    
    steps:
      - name: Download performance artifacts
        uses: actions/download-artifact@v3
        with:
          name: performance-report
          path: ./artifacts

      - name: Compare with baseline
        run: |
          npm run performance:compare -- --baseline ./baseline.json --current ./artifacts/.lighthouseci/lhr-*.json

      - name: Generate performance report
        run: |
          npm run performance:report -- --input ./artifacts/.lighthouseci/lhr-*.json --output ./performance-report.md

      - name: Upload performance report
        uses: actions/upload-artifact@v3
        with:
          name: performance-comparison-report
          path: performance-report.md

      - name: Comment on PR with performance changes
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v6
        with:
          script: |
            const report = require('fs').readFileSync('./performance-report.md', 'utf8');
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Performance Report\n\n${report}`
            });

7.2 Performance Regression Testing
typescript

// tests/performance/regression.test.ts
import { test, expect } from '@playwright/test'
import { PerformanceTester } from '@/lib/testing/performance-tests'
import { PerformanceBudgets } from '@/lib/monitoring/performance-budgets'

test.describe('Performance Regression Tests', () => {
  test('Core Web Vitals should meet budgets', async ({ page }) => {
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    
    // Run Lighthouse test
    const lighthouseResult = await PerformanceTester.runLighthouseTest(url, {
      device: 'Desktop Chrome',
      runs: 3,
    })
    
    // Check Core Web Vitals
    expect(lighthouseResult.metrics.performance).toBeGreaterThanOrEqual(90)
    expect(lighthouseResult.metrics.accessibility).toBeGreaterThanOrEqual(90)
    expect(lighthouseResult.metrics.bestPractices).toBeGreaterThanOrEqual(90)
    expect(lighthouseResult.metrics.seo).toBeGreaterThanOrEqual(90)
    
    // Check specific Web Vitals
    expect(lighthouseResult.audits['largest-contentful-paint'].score).toBeGreaterThanOrEqual(0.9)
    expect(lighthouseResult.audits['cumulative-layout-shift'].score).toBeGreaterThanOrEqual(0.9)
    expect(lighthouseResult.audits['first-input-delay'].score).toBeGreaterThanOrEqual(0.9)
  })
  
  test('Bundle size should not exceed budgets', async () => {
    const budgets = await PerformanceBudgets.checkBudgets()
    
    const failedBudgets = budgets.filter(budget => budget.status === 'failed')
    
    if (failedBudgets.length > 0) {
      console.error('Performance budgets exceeded:')
      failedBudgets.forEach(budget => {
        console.error(`- ${budget.name}: ${budget.actual}${budget.unit} (budget: ${budget.budget}${budget.unit})`)
      })
    }
    
    expect(failedBudgets.length).toBe(0)
  })
  
  test('Load test should handle concurrent users', async () => {
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    
    const loadTestResult = await PerformanceTester.runLoadTest(url, 10, 60) // 10 users for 60 seconds
    
    expect(loadTestResult.successRate).toBeGreaterThanOrEqual(99)
    expect(loadTestResult.avgResponseTime).toBeLessThanOrEqual(500)
    expect(loadTestResult.p95ResponseTime).toBeLessThanOrEqual(1000)
    expect(loadTestResult.p99ResponseTime).toBeLessThanOrEqual(2000)
  })
  
  test('Mobile performance should meet thresholds', async ({ page }) => {
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    
    // Run Lighthouse test with mobile emulation
    const lighthouseResult = await PerformanceTester.runLighthouseTest(url, {
      device: 'iPhone 12',
      throttling: 'slow4g',
      runs: 3,
    })
    
    // Mobile-specific thresholds (slightly relaxed)
    expect(lighthouseResult.metrics.performance).toBeGreaterThanOrEqual(80)
    expect(lighthouseResult.metrics.accessibility).toBeGreaterThanOrEqual(90)
    expect(lighthouseResult.metrics.bestPractices).toBeGreaterThanOrEqual(90)
    
    // Check mobile-specific audits
    expect(lighthouseResult.audits['viewport'].score).toBeGreaterThanOrEqual(1)
    expect(lighthouseResult.audits['tap-targets'].score).toBeGreaterThanOrEqual(0.9)
    expect(lighthouseResult.audits['font-size'].score).toBeGreaterThanOrEqual(0.9)
  })
  
  test('Progressive Web App requirements', async ({ page }) => {
    const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    
    const lighthouseResult = await PerformanceTester.runLighthouseTest(url, {
      device: 'Desktop Chrome',
      runs: 1,
    })
    
    // PWA checks
    expect(lighthouseResult.metrics.pwa).toBeGreaterThanOrEqual(90)
    expect(lighthouseResult.audits['installable-manifest'].score).toBeGreaterThanOrEqual(1)
    expect(lighthouseResult.audits['service-worker'].score).toBeGreaterThanOrEqual(1)
    expect(lighthouseResult.audits['https'].score).toBeGreaterThanOrEqual(1)
    expect(lighthouseResult.audits['offline-start-url'].score).toBeGreaterThanOrEqual(1)
  })
})

7.3 Performance Monitoring Schedule

// lib/monitoring/scheduler.ts
import cron from 'node-cron'

export class PerformanceScheduler {
  static schedulePerformanceTasks() {
    // Daily performance audit at 2 AM
    cron.schedule('0 2 * * *', async () => {
      console.log('Running daily performance audit...')
      await this.runDailyAudit()
    })
    
    // Weekly performance report every Monday at 9 AM
    cron.schedule('0 9 * * 1', async () => {
      console.log('Running weekly performance report...')
      await this.generateWeeklyReport()
    })
    
    // Monthly performance review on the 1st at 10 AM
    cron.schedule('0 10 1 * *', async () => {
      console.log('Running monthly performance review...')
      await this.generateMonthlyReview()
    })
    
    // Continuous monitoring every 5 minutes during business hours
    cron.schedule('*/5 9-17 * * 1-5', async () => {
      console.log('Running continuous performance monitoring...')
      await this.runContinuousMonitoring()
    })
  }
  
  static async runDailyAudit() {
    try {
      // Check performance budgets
      const budgetChecks = await PerformanceBudgets.checkBudgets()
      const failedBudgets = budgetChecks.filter(check => check.status === 'failed')
      
      if (failedBudgets.length > 0) {
        await this.sendAlert('Performance Budgets Exceeded', failedBudgets)
      }
      
      // Run Lighthouse audit
      const url = process.env.NEXT_PUBLIC_APP_URL!
      const lighthouseResult = await PerformanceTester.runLighthouseTest(url, {
        device: 'Desktop Chrome',
        runs: 3,
      })
      
      // Check for regressions
      await this.checkForRegressions(lighthouseResult)
      
      // Store results
      await this.storeAuditResults({
        type: 'daily',
        timestamp: new Date().toISOString(),
        lighthouseScore: lighthouseResult.metrics.performance,
        budgetChecks: budgetChecks.map(check => ({
          name: check.name,
          status: check.status,
          actual: check.actual,
          budget: check.budget,
        })),
        recommendations: this.generateRecommendations(lighthouseResult, budgetChecks),
      })
    } catch (error) {
      console.error('Daily performance audit failed:', error)
      await this.sendAlert('Daily Performance Audit Failed', [{
        name: 'Audit Error',
        description: `Failed to run daily performance audit: ${error.message}`,
        severity: 'high',
      }])
    }
  }
  
  static async generateWeeklyReport() {
    try {
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      
      // Fetch weekly performance data
      const { data: performanceData } = await supabase
        .from('performance_metrics')
        .select('*')
        .gte('timestamp', weekAgo.toISOString())
        .order('timestamp', { ascending: true })
      
      const { data: bundleData } = await supabase
        .from('bundle_metrics')
        .select('*')
        .gte('timestamp', weekAgo.toISOString())
        .order('timestamp', { ascending: true })
      
      const { data: alertData } = await supabase
        .from('performance_alerts')
        .select('*')
        .gte('created_at', weekAgo.toISOString())
        .order('created_at', { ascending: false })
      
      // Calculate weekly statistics
      const weeklyStats = {
        performance: {
          averageLCP: performanceData.reduce((sum, item) => sum + (item.lcp || 0), 0) / performanceData.length,
          averageFID: performanceData.reduce((sum, item) => sum + (item.fid || 0), 0) / performanceData.length,
          averageCLS: performanceData.reduce((sum, item) => sum + (item.cls || 0), 0) / performanceData.length,
          averageINP: performanceData.reduce((sum, item) => sum + (item.inp || 0), 0) / performanceData.length,
          bestDay: performanceData.reduce((best, item) => 
            item.lcp < best.lcp ? item : best
          ),
          worstDay: performanceData.reduce((worst, item) => 
            item.lcp > worst.lcp ? item : worst
          ),
        },
        bundle: {
          averageJS: bundleData.reduce((sum, item) => sum + (item.js_size || 0), 0) / bundleData.length,
          averageCSS: bundleData.reduce((sum, item) => sum + (item.css_size || 0), 0) / bundleData.length,
          averageTotal: bundleData.reduce((sum, item) => sum + (item.total_size || 0), 0) / bundleData.length,
          trend: bundleData.length > 1 ? 
            bundleData[bundleData.length - 1].total_size - bundleData[0].total_size : 0,
        },
        alerts: {
          total: alertData.length,
          critical: alertData.filter(a => a.severity === 'critical').length,
          warning: alertData.filter(a => a.severity === 'warning').length,
          resolved: alertData.filter(a => a.resolved).length,
          unresolved: alertData.filter(a => !a.resolved).length,
        },
      }
      
      // Generate report
      const report = `
# WEEKLY PERFORMANCE REPORT
**Period:** ${weekAgo.toLocaleDateString()} to ${now.toLocaleDateString()}
**Generated:** ${now.toISOString()}

## PERFORMANCE SUMMARY
- **Average LCP:** ${weeklyStats.performance.averageLCP.toFixed(2)}ms
- **Average FID:** ${weeklyStats.performance.averageFID.toFixed(2)}ms
- **Average CLS:** ${weeklyStats.performance.averageCLS.toFixed(4)}
- **Average INP:** ${weeklyStats.performance.averageINP.toFixed(2)}ms
- **Best Day:** ${weeklyStats.performance.bestDay.timestamp} (LCP: ${weeklyStats.performance.bestDay.lcp}ms)
- **Worst Day:** ${weeklyStats.performance.worstDay.timestamp} (LCP: ${weeklyStats.performance.worstDay.lcp}ms)

## BUNDLE SIZE SUMMARY
- **Average JS Size:** ${weeklyStats.bundle.averageJS.toFixed(2)}KB
- **Average CSS Size:** ${weeklyStats.bundle.averageCSS.toFixed(2)}KB
- **Average Total Size:** ${weeklyStats.bundle.averageTotal.toFixed(2)}KB
- **Size Trend:** ${weeklyStats.bundle.trend > 0 ? '📈 Increased by ' : '📉 Decreased by '}${Math.abs(weeklyStats.bundle.trend).toFixed(2)}KB

## ALERT SUMMARY
- **Total Alerts:** ${weeklyStats.alerts.total}
- **Critical:** ${weeklyStats.alerts.critical}
- **Warnings:** ${weeklyStats.alerts.warning}
- **Resolved:** ${weeklyStats.alerts.resolved}
- **Unresolved:** ${weeklyStats.alerts.unresolved}

## TOP RECOMMENDATIONS
${this.generateTopRecommendations(weeklyStats)}

## NEXT WEEK FOCUS
1. Address ${weeklyStats.alerts.unresolved} unresolved alerts
2. ${weeklyStats.bundle.trend > 0 ? 'Reduce bundle size growth' : 'Maintain bundle size optimization'}
3. ${weeklyStats.performance.averageLCP > 2500 ? 'Focus on LCP optimization' : 'Maintain LCP performance'}
      `
      
      // Store report
      await supabase.from('performance_reports').insert({
        type: 'weekly',
        period_start: weekAgo.toISOString(),
        period_end: now.toISOString(),
        report,
        statistics: weeklyStats,
        generated_at: now.toISOString(),
      })
      
      // Send to Slack/Email
      await this.sendWeeklyReport(report)
      
    } catch (error) {
      console.error('Weekly performance report generation failed:', error)
    }
  }
  
  static async generateMonthlyReview() {
    try {
      const now = new Date()
      const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
      
      // Fetch monthly data
      const { data: monthlyData } = await supabase
        .from('performance_reports')
        .select('*')
        .eq('type', 'weekly')
        .gte('period_start', monthAgo.toISOString())
        .order('period_start', { ascending: true })
      
      const { data: allAlerts } = await supabase
        .from('performance_alerts')
        .select('*')
        .gte('created_at', monthAgo.toISOString())
      
      const { data: budgetViolations } = await supabase
        .from('budget_violations')
        .select('*')
        .gte('created_at', monthAgo.toISOString())
      
      // Calculate monthly trends
      const trends = this.calculateMonthlyTrends(monthlyData)
      
      // Generate review document
      const review = `
# MONTHLY PERFORMANCE REVIEW
**Month:** ${monthAgo.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
**Generated:** ${now.toISOString()}

## EXECUTIVE SUMMARY
- **Overall Performance Trend:** ${trends.overallTrend}
- **Budget Compliance Rate:** ${trends.budgetComplianceRate}%
- **Alert Resolution Rate:** ${trends.alertResolutionRate}%
- **Key Achievements:** ${trends.achievements.join(', ')}

## PERFORMANCE TRENDS
${trends.performanceTrends.map(trend => `
### ${trend.metric}
- **Start of Month:** ${trend.startValue}
- **End of Month:** ${trend.endValue}
- **Change:** ${trend.change > 0 ? '+' : ''}${trend.change} (${trend.percentageChange > 0 ? '+' : ''}${trend.percentageChange}%)
- **Trend:** ${trend.trendDirection}
`).join('\n')}

## BUDGET COMPLIANCE
- **Total Budget Checks:** ${budgetViolations.length}
- **Compliant:** ${budgetViolations.filter(v => !v.violated).length}
- **Violations:** ${budgetViolations.filter(v => v.violated).length}
- **Common Violations:** ${this.getCommonViolations(budgetViolations)}

## ALERT ANALYSIS
- **Total Alerts:** ${allAlerts.length}
- **Average Resolution Time:** ${trends.averageResolutionTime}
- **Most Common Alert Types:** ${this.getCommonAlertTypes(allAlerts)}
- **Root Cause Analysis:** ${this.analyzeRootCauses(allAlerts)}

## RECOMMENDATIONS FOR NEXT MONTH
1. ${trends.recommendations[0]}
2. ${trends.recommendations[1]}
3. ${trends.recommendations[2]}

## SUCCESS METRICS
- **User Satisfaction Score:** ${trends.userSatisfaction}/100
- **Performance Score Improvement:** ${trends.performanceImprovement}%
- **Cost Savings:** ${trends.costSavings}
      `
      
      // Store monthly review
      await supabase.from('performance_reviews').insert({
        type: 'monthly',
        period_start: monthAgo.toISOString(),
        period_end: now.toISOString(),
        review,
        trends,
        generated_at: now.toISOString(),
      })
      
      // Send to stakeholders
      await this.sendMonthlyReview(review)
      
    } catch (error) {
      console.error('Monthly performance review generation failed:', error)
    }
  }
  
  static async runContinuousMonitoring() {
    try {
      const url = process.env.NEXT_PUBLIC_APP_URL!
      
      // Quick Lighthouse check (single run for speed)
      const lighthouseResult = await PerformanceTester.runLighthouseTest(url, {
        device: 'Desktop Chrome',
        runs: 1,
        throttling: 'none',
      })
      
      // Check budgets
      const budgetChecks = await PerformanceBudgets.checkBudgets()
      const violations = budgetChecks.filter(check => check.status !== 'passed')
      
      if (violations.length > 0) {
        await this.sendAlert('Budget Violation Detected', violations.map(violation => ({
          name: violation.name,
          description: `${violation.name} exceeded budget: ${violation.actual}${violation.unit} vs ${violation.budget}${violation.unit}`,
          severity: violation.status === 'failed' ? 'critical' : 'warning',
          value: violation.actual,
          threshold: violation.budget,
        })))
      }
      
      // Check Core Web Vitals thresholds
      const criticalMetrics = []
      if (lighthouseResult.metrics.performance < 50) {
        criticalMetrics.push({
          name: 'Performance Score',
          value: lighthouseResult.metrics.performance,
          threshold: 50,
        })
      }
      
      if (criticalMetrics.length > 0) {
        await this.sendAlert('Critical Performance Degradation', criticalMetrics)
      }
      
      // Store monitoring check
      await supabase.from('continuous_monitoring').insert({
        timestamp: new Date().toISOString(),
        performance_score: lighthouseResult.metrics.performance,
        budget_violations: violations.length,
        critical_alerts: criticalMetrics.length,
        url,
      })
      
    } catch (error) {
      console.error('Continuous monitoring failed:', error)
    }
  }
  
  private static async storeAuditResults(results: any) {
    await supabase.from('performance_audits').insert({
      ...results,
      created_at: new Date().toISOString(),
    })
  }
  
  private static async checkForRegressions(lighthouseResult: any) {
    // Get previous day's results
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    
    const { data: previousResults } = await supabase
      .from('performance_audits')
      .select('*')
      .eq('type', 'daily')
      .gte('timestamp', yesterday.toISOString())
      .lt('timestamp', new Date().toISOString())
      .order('timestamp', { ascending: false })
      .limit(1)
    
    if (previousResults && previousResults.length > 0) {
      const previous = previousResults[0]
      const currentScore = lighthouseResult.metrics.performance
      const previousScore = previous.lighthouseScore
      
      // Check for significant regression (>10% drop)
      if (currentScore < previousScore * 0.9) {
        await this.sendAlert('Performance Regression Detected', [{
          name: 'Performance Score',
          description: `Performance score dropped from ${previousScore} to ${currentScore} (${((previousScore - currentScore) / previousScore * 100).toFixed(1)}% decrease)`,
          severity: 'critical',
          previousScore,
          currentScore,
          change: currentScore - previousScore,
        }])
      }
    }
  }
  
  private static async sendAlert(title: string, alerts: any[]) {
    // Send to Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${title}*`,
          attachments: alerts.map(alert => ({
            color: alert.severity === 'critical' ? '#ff0000' : '#ffcc00',
            fields: [
              { title: 'Metric', value: alert.name, short: true },
              { title: 'Value', value: `${alert.value}${alert.unit || ''}`, short: true },
              { title: 'Threshold', value: `${alert.threshold}${alert.unit || ''}`, short: true },
              { title: 'Description', value: alert.description, short: false },
            ],
          })),
        }),
      })
    }
    
    // Send to email
    if (process.env.ALERT_EMAIL_RECIPIENTS) {
      const recipients = process.env.ALERT_EMAIL_RECIPIENTS.split(',')
      // Implement email sending logic here
    }
    
    // Store alert
    await supabase.from('performance_alerts').insert(
      alerts.map(alert => ({
        title,
        ...alert,
        created_at: new Date().toISOString(),
        resolved: false,
      }))
    )
  }
  
  private static async sendWeeklyReport(report: string) {
    // Send to configured channels
    if (process.env.WEEKLY_REPORT_SLACK_CHANNEL) {
      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '*Weekly Performance Report*',
          attachments: [{
            color: '#36a64f',
            text: report.substring(0, 2000) + '...',
          }],
        }),
      })
    }
    
    if (process.env.WEEKLY_REPORT_EMAIL_RECIPIENTS) {
      // Implement email sending logic here
    }
  }
  
  private static async sendMonthlyReview(review: string) {
    // Send to stakeholders
    if (process.env.MONTHLY_REVIEW_SLACK_CHANNEL) {
      await fetch(process.env.SLACK_WEBHOOK_URL!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '*Monthly Performance Review*',
          attachments: [{
            color: '#4a86e8',
            text: review.substring(0, 2000) + '...',
          }],
        }),
      })
    }
    
    if (process.env.MONTHLY_REVIEW_EMAIL_RECIPIENTS) {
      // Implement email sending logic here
    }
  }
  
  private static generateTopRecommendations(stats: any): string {
    const recommendations: string[] = []
    
    if (stats.performance.averageLCP > 2500) {
      recommendations.push('Optimize Largest Contentful Paint by implementing image optimization, lazy loading, and resource hints')
    }
    
    if (stats.performance.averageCLS > 0.1) {
      recommendations.push('Reduce Cumulative Layout Shift by setting explicit dimensions on media and avoiding late-loading content')
    }
    
    if (stats.bundle.trend > 0) {
      recommendations.push('Address bundle size growth through code splitting, tree shaking, and dependency optimization')
    }
    
    if (stats.alerts.unresolved > 0) {
      recommendations.push(`Resolve ${stats.alerts.unresolved} outstanding performance alerts`)
    }
    
    return recommendations.map((rec, index) => `${index + 1}. ${rec}`).join('\n')
  }
  
  private static calculateMonthlyTrends(monthlyData: any[]): any {
    if (!monthlyData || monthlyData.length < 2) {
      return {
        overallTrend: 'Insufficient data',
        budgetComplianceRate: 0,
        alertResolutionRate: 0,
        achievements: [],
        performanceTrends: [],
        recommendations: [],
        userSatisfaction: 0,
        performanceImprovement: 0,
        costSavings: '$0',
      }
    }
    
    const firstWeek = monthlyData[0]
    const lastWeek = monthlyData[monthlyData.length - 1]
    
    return {
      overallTrend: lastWeek.statistics.performance.averageLCP < firstWeek.statistics.performance.averageLCP ? 'Improving' : 'Declining',
      budgetComplianceRate: Math.round(
        (lastWeek.statistics.budgetChecks.filter((c: any) => c.status === 'passed').length /
         lastWeek.statistics.budgetChecks.length) * 100
      ),
      alertResolutionRate: Math.round(
        (lastWeek.statistics.alerts.resolved / lastWeek.statistics.alerts.total) * 100
      ),
      achievements: this.generateAchievements(monthlyData),
      performanceTrends: this.calculatePerformanceTrends(monthlyData),
      recommendations: this.generateMonthlyRecommendations(monthlyData),
      userSatisfaction: this.calculateUserSatisfaction(monthlyData),
      performanceImprovement: this.calculateImprovementPercentage(firstWeek, lastWeek),
      costSavings: this.calculateCostSavings(monthlyData),
    }
  }
  
  private static generateAchievements(data: any[]): string[] {
    const achievements: string[] = []
    const latest = data[data.length - 1]
    
    if (latest.statistics.performance.averageLCP < 2500) {
      achievements.push('Achieved LCP target of <2.5s')
    }
    
    if (latest.statistics.performance.averageCLS < 0.1) {
      achievements.push('Achieved CLS target of <0.1')
    }
    
    if (latest.statistics.bundle.trend <= 0) {
      achievements.push('Reduced or maintained bundle size')
    }
    
    if (latest.statistics.alerts.unresolved === 0) {
      achievements.push('All performance alerts resolved')
    }
    
    return achievements
  }
}
```

---
### **8. PERFORMANCE OPTIMIZATION CHECKLIST**

#### **8.1 Pre-Deployment Checklist** 
# PERFORMANCE OPTIMIZATION CHECKLIST

## ✅ CORE WEB VITALS
- [ ] LCP < 2.5 seconds
- [ ] FID < 100 milliseconds
- [ ] CLS < 0.1
- [ ] INP < 200 milliseconds

## ✅ BUNDLE SIZE
- [ ] Total bundle size < 220KB
- [ ] JavaScript bundle < 170KB
- [ ] CSS bundle < 50KB
- [ ] Third-party JavaScript < 100KB
- [ ] Tree shaking enabled
- [ ] Code splitting implemented
- [ ] Dynamic imports for heavy libraries
- [ ] Bundle analysis run and reviewed

## ✅ IMAGE OPTIMIZATION
- [ ] Images converted to WebP/AVIF format
- [ ] Proper image dimensions specified
- [ ] Lazy loading implemented for below-the-fold images
- [ ] Responsive images with srcset
- [ ] Image CDN configured
- [ ] Blur placeholders for lazy-loaded images
- [ ] Image compression applied (quality 75-85%)

## ✅ CACHING STRATEGY
- [ ] Browser caching headers configured
- [ ] CDN caching enabled
- [ ] Service Worker for offline support
- [ ] Cache invalidation strategy defined
- [ ] ETag headers implemented
- [ ] Cache warming for critical pages
- [ ] Stale-while-revalidate pattern implemented

## ✅ RESOURCE OPTIMIZATION
- [ ] HTTP/2 enabled
- [ ] Gzip/Brotli compression enabled
- [ ] Minification enabled (HTML, CSS, JS)
- [ ] CSS/JS concatenation optimized
- [ ] Font subsetting implemented
- [ ] Resource hints (preload, prefetch, preconnect)
- [ ] Critical CSS extracted and inlined
- [ ] Non-critical CSS deferred

## ✅ NETWORK OPTIMIZATION
- [ ] DNS prefetching configured
- [ ] Connection reuse enabled
- [ ] Keep-alive connections configured
- [ ] TCP fast open enabled
- [ ] QUIC/HTTP3 enabled if available
- [ ] CDN edge locations optimized

## ✅ RENDERING OPTIMIZATION
- [ ] Server-side rendering configured
- [ ] Static generation for static pages
- [ ] Incremental Static Regeneration configured
- [ ] React.memo() for expensive components
- [ ] useMemo()/useCallback() for expensive computations
- [ ] Virtualization for long lists
- [ ] Debounced/throttled event handlers
- [ ] requestAnimationFrame() for animations

## ✅ DATABASE OPTIMIZATION
- [ ] Indexes created for frequent queries
- [ ] Query optimization performed
- [ ] Connection pooling configured
- [ ] Read replicas configured for heavy reads
- [ ] Query caching enabled
- [ ] Database monitoring configured
- [ ] Slow query logging enabled

## ✅ MONITORING & ALERTING
- [ ] Real User Monitoring (RUM) configured
- [ ] Synthetic monitoring configured
- [ ] Performance budgets defined
- [ ] Alerting thresholds configured
- [ ] Performance regression testing
- [ ] A/B testing for performance changes
- [ ] Performance dashboard available

## ✅ ACCESSIBILITY & SEO
- [ ] ARIA labels implemented
- [ ] Keyboard navigation tested
- [ ] Screen reader compatibility tested
- [ ] Semantic HTML structure
- [ ] Open Graph metadata configured
- [ ] Structured data implemented
- [ ] XML sitemap generated
- [ ] robots.txt configured

## ✅ SECURITY HEADERS
- [ ] Content Security Policy configured
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] X-XSS-Protection: 1; mode=block
- [ ] Referrer-Policy configured
- [ ] Strict-Transport-Security configured
- [ ] Permissions-Policy configured

## ✅ MOBILE OPTIMIZATION
- [ ] Responsive design tested on multiple devices
- [ ] Touch targets ≥ 44px
- [ ] Font size ≥ 16px for inputs
- [ ] Viewport meta tag configured
- [ ] Mobile-specific optimizations applied
- [ ] PWA manifest configured
- [ ] Service Worker for offline capability

## ✅ THIRD-PARTY OPTIMIZATION
- [ ] Third-party scripts async/deferred
- [ ] Lazy loading for non-critical third parties
- [ ] DNS prefetching for third-party domains
- [ ] Resource loading strategy defined
- [ ] Third-party performance monitored
- [ ] Fallbacks for third-party failures

## ✅ BUILD OPTIMIZATION
- [ ] Build cache configured
- [ ] Parallel builds enabled
- [ ] Incremental compilation enabled
- [ ] Dead code elimination verified
- [ ] Source maps configured for production
- [ ] Build time monitoring configured
- [ ] Automated performance testing in CI/CD

#### **8.2 Performance Audit Script**
```typescript
// performance-audit.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

interface AuditResult {
  category: string;
  metric: string;
  value: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  threshold: number;
  message: string;
  timestamp: Date;
}

class PerformanceAuditor {
  private results: AuditResult[] = [];
  private readonly CONFIG = {
    thresholds: {
      bundleSize: {
        warning: 150000, // 150KB
        critical: 200000, // 200KB
      },
      lighthouse: {
        performance: 90,
        accessibility: 95,
        bestPractices: 95,
        seo: 90,
      },
      apiResponse: {
        warning: 500, // 500ms
        critical: 1000, // 1s
      },
      memoryUsage: {
        warning: 80, // 80%
        critical: 90, // 90%
      },
    },
  };

  async runFullAudit(): Promise<AuditResult[]> {
    console.log('🚀 Starting comprehensive performance audit...');
    
    await this.auditBundleSize();
    await this.auditLighthouseMetrics();
    await this.auditAPIPerformance();
    await this.auditMemoryUsage();
    await this.auditDatabaseQueries();
    await this.auditCachingEfficiency();
    
    this.generateReport();
    return this.results;
  }

  private async auditBundleSize(): Promise<void> {
    const outputPath = './next-stats.json';
    
    try {
      // Generate Next.js build stats
      execSync('npx next build --profile', { stdio: 'pipe' });
      execSync(`npx next build --profile --analyze > ${outputPath}`, { 
        stdio: 'pipe' 
      });

      const stats = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      const mainBundleSize = stats.pageStats['/']?.size || 0;
      
      this.addResult({
        category: 'Bundle',
        metric: 'Main Bundle Size',
        value: mainBundleSize,
        status: this.evaluateThreshold(
          mainBundleSize,
          this.CONFIG.thresholds.bundleSize
        ),
        threshold: this.CONFIG.thresholds.bundleSize.warning,
        message: `Main bundle size: ${(mainBundleSize / 1024).toFixed(2)}KB`,
      });
    } catch (error) {
      console.error('Bundle audit failed:', error);
    }
  }

  private async auditLighthouseMetrics(): Promise<void> {
    const urls = ['/', '/dashboard', '/agents'];
    
    for (const url of urls) {
      try {
        // Run Lighthouse CI
        const lhciCommand = `npx lighthouse-ci ${url} --score=100`;
        const output = execSync(lhciCommand, { encoding: 'utf-8' });
        
        const scores = this.parseLighthouseOutput(output);
        
        ['performance', 'accessibility', 'best-practices', 'seo'].forEach(
          (metric) => {
            const score = scores[metric] || 0;
            this.addResult({
              category: 'Lighthouse',
              metric: `${metric.charAt(0).toUpperCase() + metric.slice(1)} (${url})`,
              value: score,
              status: this.evaluateThreshold(
                score,
                this.CONFIG.thresholds.lighthouse,
                true // Higher is better
              ),
              threshold: this.CONFIG.thresholds.lighthouse[metric] || 90,
              message: `${metric}: ${score}/100`,
            });
          }
        );
      } catch (error) {
        console.error(`Lighthouse audit failed for ${url}:`, error);
      }
    }
  }

  private async auditAPIPerformance(): Promise<void> {
    const endpoints = [
      '/api/agents',
      '/api/context',
      '/api/metrics',
      '/api/auth/session',
    ];

    for (const endpoint of endpoints) {
      const startTime = Date.now();
      
      try {
        const response = await fetch(`http://localhost:3000${endpoint}`, {
          headers: { 'Content-Type': 'application/json' },
        });
        
        const responseTime = Date.now() - startTime;
        
        this.addResult({
          category: 'API',
          metric: `Response Time - ${endpoint}`,
          value: responseTime,
          status: this.evaluateThreshold(
            responseTime,
            this.CONFIG.thresholds.apiResponse
          ),
          threshold: this.CONFIG.thresholds.apiResponse.warning,
          message: `${endpoint}: ${responseTime}ms`,
        });
        
        // Check payload size
        const data = await response.json();
        const payloadSize = new Blob([JSON.stringify(data)]).size;
        
        this.addResult({
          category: 'API',
          metric: `Payload Size - ${endpoint}`,
          value: payloadSize,
          status: payloadSize > 100000 ? 'WARN' : 'PASS',
          threshold: 100000, // 100KB
          message: `Payload size: ${(payloadSize / 1024).toFixed(2)}KB`,
        });
      } catch (error) {
        this.addResult({
          category: 'API',
          metric: `Availability - ${endpoint}`,
          value: 0,
          status: 'FAIL',
          threshold: 1,
          message: `Endpoint failed: ${error.message}`,
        });
      }
    }
  }

  private async auditMemoryUsage(): Promise<void> {
    const memoryUsage = process.memoryUsage();
    const heapUsed = memoryUsage.heapUsed / 1024 / 1024; // MB
    const heapTotal = memoryUsage.heapTotal / 1024 / 1024; // MB
    const usagePercentage = (heapUsed / heapTotal) * 100;

    this.addResult({
      category: 'Memory',
      metric: 'Heap Usage',
      value: usagePercentage,
      status: this.evaluateThreshold(
        usagePercentage,
        this.CONFIG.thresholds.memoryUsage
      ),
      threshold: this.CONFIG.thresholds.memoryUsage.warning,
      message: `Heap: ${heapUsed.toFixed(2)}MB/${heapTotal.toFixed(2)}MB (${usagePercentage.toFixed(1)}%)`,
    });
  }

  private async auditDatabaseQueries(): Promise<void> {
    // This would connect to your database and run sample queries
    // For Supabase, you'd use the Supabase client
    const sampleQueries = [
      {
        name: 'Agent Context Fetch',
        query: 'SELECT * FROM agent_context WHERE updated_at > NOW() - INTERVAL \'1 hour\'',
      },
      {
        name: 'User Sessions',
        query: 'SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW()',
      },
    ];

    for (const { name, query } of sampleQueries) {
      const startTime = Date.now();
      
      try {
        // Execute query via Supabase client
        // const { data, error } = await supabase.rpc('execute_query', { sql: query });
        const executionTime = Date.now() - startTime;
        
        this.addResult({
          category: 'Database',
          metric: `Query Time - ${name}`,
          value: executionTime,
          status: executionTime > 100 ? 'WARN' : 'PASS',
          threshold: 100, // 100ms
          message: `${name}: ${executionTime}ms`,
        });
      } catch (error) {
        this.addResult({
          category: 'Database',
          metric: `Query Error - ${name}`,
          value: 0,
          status: 'FAIL',
          threshold: 0,
          message: `Query failed: ${error.message}`,
        });
      }
    }
  }

  private async auditCachingEfficiency(): Promise<void> {
    // Simulate cache hit rate check
    const cacheTests = [
      { key: 'agents:list', ttl: 300 },
      { key: 'user:profile:1', ttl: 3600 },
      { key: 'metrics:dashboard', ttl: 60 },
    ];

    for (const test of cacheTests) {
      // This would check your Redis/Vercel KV cache
      // const hitRate = await getCacheHitRate(test.key);
      const hitRate = Math.random() * 100; // Simulated for example
      
      this.addResult({
        category: 'Cache',
        metric: `Hit Rate - ${test.key}`,
        value: hitRate,
        status: hitRate > 80 ? 'PASS' : hitRate > 60 ? 'WARN' : 'FAIL',
        threshold: 80,
        message: `Cache hit rate: ${hitRate.toFixed(1)}%`,
      });
    }
  }

  private evaluateThreshold(
    value: number,
    thresholds: { warning: number; critical: number },
    higherIsBetter: boolean = false
  ): 'PASS' | 'WARN' | 'FAIL' {
    if (higherIsBetter) {
      if (value >= thresholds.warning) return 'PASS';
      if (value >= thresholds.critical) return 'WARN';
      return 'FAIL';
    } else {
      if (value <= thresholds.warning) return 'PASS';
      if (value <= thresholds.critical) return 'WARN';
      return 'FAIL';
    }
  }

  private parseLighthouseOutput(output: string): Record<string, number> {
    const scores: Record<string, number> = {};
    const regex = /(\w+)\s+(\d+)\s+(\d+)/g;
    let match;
    
    while ((match = regex.exec(output)) !== null) {
      const [, metric, score] = match;
      scores[metric.toLowerCase()] = parseInt(score, 10);
    }
    
    return scores;
  }

  private addResult(result: Omit<AuditResult, 'timestamp'>): void {
    this.results.push({
      ...result,
      timestamp: new Date(),
    });
  }

  private generateReport(): void {
    const report = {
      summary: {
        totalTests: this.results.length,
        passed: this.results.filter(r => r.status === 'PASS').length,
        warnings: this.results.filter(r => r.status === 'WARN').length,
        failed: this.results.filter(r => r.status === 'FAIL').length,
        timestamp: new Date().toISOString(),
      },
      results: this.results,
      recommendations: this.generateRecommendations(),
    };

    const reportPath = path.join(process.cwd(), 'performance-audit-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📊 Audit report saved to: ${reportPath}`);
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    
    const failedAudits = this.results.filter(r => r.status === 'FAIL');
    const warningAudits = this.results.filter(r => r.status === 'WARN');
    
    failedAudits.forEach(audit => {
      recommendations.push(`🚨 CRITICAL: Fix ${audit.metric} - ${audit.message}`);
    });
    
    warningAudits.forEach(audit => {
      recommendations.push(`⚠️  WARNING: Improve ${audit.metric} - ${audit.message}`);
    });
    
    // Bundle-specific recommendations
    const bundleIssues = this.results.filter(r => 
      r.category === 'Bundle' && r.status !== 'PASS'
    );
    if (bundleIssues.length > 0) {
      recommendations.push('📦 Consider code splitting large bundles using dynamic imports');
      recommendations.push('🔧 Review and optimize third-party dependencies');
    }
    
    // API-specific recommendations
    const slowAPIs = this.results.filter(r => 
      r.category === 'API' && r.value > 300
    );
    if (slowAPIs.length > 0) {
      recommendations.push('⚡ Implement caching for slow API endpoints');
      recommendations.push('🧩 Consider implementing GraphQL or gRPC for data fetching');
    }
    
    return recommendations;
  }
}

// Export for use in CI/CD
export const auditor = new PerformanceAuditor();

// CLI interface
if (require.main === module) {
  auditor.runFullAudit().then(results => {
    console.log('✅ Performance audit completed');
    process.exit(results.every(r => r.status === 'PASS') ? 0 : 1);
  }).catch(error => {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  });
}
```

#### **8.3 Continuous Monitoring Script**
```typescript
// continuous-monitoring.ts
import { performance } from 'perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { Redis } from 'ioredis';

interface PerformanceMetric {
  id?: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  component: string;
  environment: 'development' | 'staging' | 'production';
  timestamp: Date;
  tags: Record<string, any>;
}

class ContinuousMonitor {
  private supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  private redis = new Redis(process.env.REDIS_URL!);
  private metricsQueue: PerformanceMetric[] = [];
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds

  constructor() {
    // Start periodic flushing
    setInterval(() => this.flushMetrics(), this.FLUSH_INTERVAL);
    
    // Capture unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.trackError('unhandled_rejection', { reason: String(reason) });
    });
    
    // Capture uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.trackError('uncaught_exception', { error: error.message });
    });
  }

  async trackAPIPerformance(
    endpoint: string,
    method: string,
    duration: number,
    statusCode: number,
    userId?: string
  ): Promise<void> {
    const metric: PerformanceMetric = {
      metric_name: 'api_response_time',
      metric_value: duration,
      metric_unit: 'milliseconds',
      component: `api:${endpoint}`,
      environment: process.env.NODE_ENV as any,
      timestamp: new Date(),
      tags: {
        method,
        status_code: statusCode,
        user_id: userId,
        endpoint,
      },
    };

    await this.queueMetric(metric);
    
    // Also track in Redis for real-time dashboards
    const redisKey = `metrics:api:${endpoint}:${method}:${statusCode}`;
    await this.redis.zadd(redisKey, Date.now(), duration);
    await this.redis.expire(redisKey, 3600); // Keep for 1 hour
  }

  async trackPageLoad(
    route: string,
    loadTime: number,
    firstContentfulPaint: number,
    largestContentfulPaint: number
  ): Promise<void> {
    const metrics = [
      {
        metric_name: 'page_load_time',
        metric_value: loadTime,
        metric_unit: 'milliseconds',
        component: `page:${route}`,
        environment: process.env.NODE_ENV as any,
        timestamp: new Date(),
        tags: { route },
      },
      {
        metric_name: 'first_contentful_paint',
        metric_value: firstContentfulPaint,
        metric_unit: 'milliseconds',
        component: `page:${route}`,
        environment: process.env.NODE_ENV as any,
        timestamp: new Date(),
        tags: { route },
      },
      {
        metric_name: 'largest_contentful_paint',
        metric_value: largestContentfulPaint,
        metric_unit: 'milliseconds',
        component: `page:${route}`,
        environment: process.env.NODE_ENV as any,
        timestamp: new Date(),
        tags: { route },
      },
    ];

    await Promise.all(metrics.map(metric => this.queueMetric(metric)));
  }

  async trackDatabaseQuery(
    query: string,
    duration: number,
    rowsAffected: number,
    success: boolean
  ): Promise<void> {
    const metric: PerformanceMetric = {
      metric_name: 'database_query_time',
      metric_value: duration,
      metric_unit: 'milliseconds',
      component: 'database',
      environment: process.env.NODE_ENV as any,
      timestamp: new Date(),
      tags: {
        query_hash: this.hashQuery(query),
        rows_affected: rowsAffected,
        success,
        query_type: this.detectQueryType(query),
      },
    };

    await this.queueMetric(metric);
  }

  async trackCachePerformance(
    key: string,
    hit: boolean,
    operation: 'get' | 'set' | 'delete',
    duration: number
  ): Promise<void> {
    const metric: PerformanceMetric = {
      metric_name: hit ? 'cache_hit' : 'cache_miss',
      metric_value: duration,
      metric_unit: 'milliseconds',
      component: 'cache',
      environment: process.env.NODE_ENV as any,
      timestamp: new Date(),
      tags: {
        operation,
        key_pattern: this.extractKeyPattern(key),
      },
    };

    await this.queueMetric(metric);
  }

  async trackError(
    errorType: string,
    metadata: Record<string, any>
  ): Promise<void> {
    const metric: PerformanceMetric = {
      metric_name: 'error',
      metric_value: 1,
      metric_unit: 'count',
      component: 'error_tracking',
      environment: process.env.NODE_ENV as any,
      timestamp: new Date(),
      tags: {
        error_type: errorType,
        ...metadata,
      },
    };

    await this.queueMetric(metric);
    
    // Send to Sentry if configured
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      // Sentry.captureException(new Error(errorType), { extra: metadata });
    }
  }

  async trackCustomMetric(
    name: string,
    value: number,
    unit: string,
    component: string,
    tags: Record<string, any> = {}
  ): Promise<void> {
    const metric: PerformanceMetric = {
      metric_name: name,
      metric_value: value,
      metric_unit: unit,
      component,
      environment: process.env.NODE_ENV as any,
      timestamp: new Date(),
      tags,
    };

    await this.queueMetric(metric);
  }

  async getPerformanceSummary(
    component: string,
    startTime: Date,
    endTime: Date
  ): Promise<any> {
    const { data, error } = await this.supabase
      .from('performance_metrics')
      .select('*')
      .eq('component', component)
      .gte('timestamp', startTime.toISOString())
      .lte('timestamp', endTime.toISOString());

    if (error) throw error;

    const summary = {
      component,
      period: { startTime, endTime },
      metrics: {} as Record<string, any>,
    };

    // Group by metric name
    const grouped = data.reduce((acc, metric) => {
      if (!acc[metric.metric_name]) {
        acc[metric.metric_name] = [];
      }
      acc[metric.metric_name].push(metric.metric_value);
      return acc;
    }, {} as Record<string, number[]>);

    // Calculate statistics
    for (const [metricName, values] of Object.entries(grouped)) {
      summary.metrics[metricName] = {
        count: values.length,
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        p95: this.percentile(values, 95),
        p99: this.percentile(values, 99),
      };
    }

    return summary;
  }

  async getAlerts(thresholds: Record<string, number>): Promise<any[]> {
    const alerts = [];
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Check for slow API responses
    const apiMetrics = await this.supabase
      .from('performance_metrics')
      .select('*')
      .eq('metric_name', 'api_response_time')
      .gte('timestamp', fiveMinutesAgo.toISOString())
      .lte('timestamp', now.toISOString());

    if (apiMetrics.data) {
      const slowApis = apiMetrics.data.filter(
        m => m.metric_value > (thresholds.api_response_time || 1000)
      );
      
      if (slowApis.length > 0) {
        alerts.push({
          type: 'SLOW_API',
          severity: 'WARNING',
          message: `${slowApis.length} API endpoints exceeding ${thresholds.api_response_time}ms threshold`,
          details: slowApis.map(m => ({
            component: m.component,
            duration: m.metric_value,
            timestamp: m.timestamp,
          })),
        });
      }
    }

    // Check for high error rates
    const errorMetrics = await this.supabase
      .from('performance_metrics')
      .select('*')
      .eq('metric_name', 'error')
      .gte('timestamp', fiveMinutesAgo.toISOString())
      .lte('timestamp', now.toISOString());

    if (errorMetrics.data && errorMetrics.data.length > 10) {
      alerts.push({
        type: 'HIGH_ERROR_RATE',
        severity: 'CRITICAL',
        message: `High error rate detected: ${errorMetrics.data.length} errors in last 5 minutes`,
        details: errorMetrics.data.slice(0, 5), // Show first 5 errors
      });
    }

    return alerts;
  }

  private async queueMetric(metric: PerformanceMetric): Promise<void> {
    this.metricsQueue.push(metric);
    
    if (this.metricsQueue.length >= this.BATCH_SIZE) {
      await this.flushMetrics();
    }
  }

  private async flushMetrics(): Promise<void> {
    if (this.metricsQueue.length === 0) return;

    const batch = [...this.metricsQueue];
    this.metricsQueue = [];

    try {
      const { error } = await this.supabase
        .from('performance_metrics')
        .insert(batch);

      if (error) {
        console.error('Failed to flush metrics:', error);
        // Requeue failed metrics (with backoff)
        this.metricsQueue.unshift(...batch.slice(0, this.BATCH_SIZE / 2));
      }
    } catch (error) {
      console.error('Error flushing metrics:', error);
    }
  }

  private hashQuery(query: string): string {
    // Simple hash for query identification
    return Buffer.from(query).toString('base64').slice(0, 32);
  }

  private detectQueryType(query: string): string {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.startsWith('select')) return 'SELECT';
    if (lowerQuery.startsWith('insert')) return 'INSERT';
    if (lowerQuery.startsWith('update')) return 'UPDATE';
    if (lowerQuery.startsWith('delete')) return 'DELETE';
    return 'OTHER';
  }

  private extractKeyPattern(key: string): string {
    // Extract pattern from cache key
    // e.g., "user:profile:123" -> "user:profile:*"
    return key.replace(/:\d+$/, ':*').replace(/[a-f0-9-]{36}/g, '*');
  }

  private percentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
   
    if (Math.floor(index) === index) {
      return sorted[index];
    }
   
    const lower = sorted[Math.floor(index)];
    const upper = sorted[Math.ceil(index)];
    return lower + (upper - lower) * (index - Math.floor(index));
  }
}

// Singleton instance
export const monitor = new ContinuousMonitor();

// Performance monitoring middleware for Next.js
export function withPerformanceMonitoring(handler: Function) {
  return async (...args: any[]) => {
    const startTime = performance.now();
   
    try {
      const result = await handler(...args);
      const duration = performance.now() - startTime;
     
      // Track performance
      await monitor.trackAPIPerformance(
        args[0]?.req?.url || 'unknown',
        args[0]?.req?.method || 'GET',
        duration,
        args[1]?.statusCode || 200
      );
     
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
     
      await monitor.trackError('handler_error', {
        error: error.message,
        duration,
        handler: handler.name,
      });
     
      throw error;
    }
  };
}
9. PERFORMANCE METRICS DATABASE SCHEMA
9.1 Supabase Tables for Performance Monitoring
sql
-- performance_metrics.sql
-- Main metrics table
CREATE TABLE performance_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  metric_value DOUBLE PRECISION NOT NULL,
  metric_unit VARCHAR(20) NOT NULL,
  component VARCHAR(100) NOT NULL,
  environment VARCHAR(20) NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  tags JSONB DEFAULT '{}'::jsonb,
  
  -- Indexes for common queries
  INDEX idx_performance_metrics_timestamp ON performance_metrics(timestamp DESC),
  INDEX idx_performance_metrics_component ON performance_metrics(component),
  INDEX idx_performance_metrics_metric_name ON performance_metrics(metric_name),
  INDEX idx_performance_metrics_environment ON performance_metrics(environment),
  
  -- Composite indexes for common query patterns
  INDEX idx_performance_metrics_component_timestamp ON performance_metrics(component, timestamp DESC),
  INDEX idx_performance_metrics_name_timestamp ON performance_metrics(metric_name, timestamp DESC),
  
  -- GIN index for JSONB tags field
  INDEX idx_performance_metrics_tags ON performance_metrics USING GIN(tags)
);

-- Performance alerts table
CREATE TABLE performance_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  message TEXT NOT NULL,
  component VARCHAR(100),
  metric_name VARCHAR(100),
  metric_value DOUBLE PRECISION,
  threshold DOUBLE PRECISION,
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  
  -- Indexes
  INDEX idx_performance_alerts_triggered_at ON performance_alerts(triggered_at DESC),
  INDEX idx_performance_alerts_severity ON performance_alerts(severity),
  INDEX idx_performance_alerts_component ON performance_alerts(component),
  INDEX idx_performance_alerts_status ON performance_alerts(
    (CASE 
      WHEN resolved_at IS NOT NULL THEN 'RESOLVED'
      WHEN acknowledged_at IS NOT NULL THEN 'ACKNOWLEDGED'
      ELSE 'OPEN'
    END)
  )
);

-- Performance baselines table (for anomaly detection)
CREATE TABLE performance_baselines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_name VARCHAR(100) NOT NULL,
  component VARCHAR(100) NOT NULL,
  environment VARCHAR(20) NOT NULL,
  window_type VARCHAR(20) NOT NULL CHECK (window_type IN ('hourly', 'daily', 'weekly')),
  statistical_metric VARCHAR(20) NOT NULL CHECK (statistical_metric IN ('avg', 'p95', 'p99', 'max', 'min')),
  baseline_value DOUBLE PRECISION NOT NULL,
  standard_deviation DOUBLE PRECISION,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
  valid_to TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Ensure no overlapping baselines
  EXCLUDE USING GIST (
    metric_name WITH =,
    component WITH =,
    environment WITH =,
    window_type WITH =,
    statistical_metric WITH =,
    tsrange(valid_from, valid_to) WITH &&
  ),
  
  -- Indexes
  INDEX idx_performance_baselines_metric_component ON performance_baselines(metric_name, component),
  INDEX idx_performance_baselines_validity ON performance_baselines(valid_from, valid_to),
  UNIQUE (metric_name, component, environment, window_type, statistical_metric, valid_from)
);

-- Performance budgets table
CREATE TABLE performance_budgets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_name VARCHAR(100) NOT NULL,
  metric_name VARCHAR(100) NOT NULL,
  component VARCHAR(100),
  target_value DOUBLE PRECISION NOT NULL,
  warning_threshold DOUBLE PRECISION,
  critical_threshold DOUBLE PRECISION,
  timeframe VARCHAR(20) NOT NULL CHECK (timeframe IN ('instant', 'hourly', 'daily', 'weekly')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  -- Indexes
  INDEX idx_performance_budgets_active ON performance_budgets(is_active),
  INDEX idx_performance_budgets_metric ON performance_budgets(metric_name),
  UNIQUE (budget_name, metric_name, component)
);

-- Performance audit history
CREATE TABLE performance_audits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  audit_type VARCHAR(50) NOT NULL CHECK (audit_type IN ('scheduled', 'manual', 'deployment')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  environment VARCHAR(20) NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  total_tests INTEGER,
  passed_tests INTEGER,
  failed_tests INTEGER,
  warnings INTEGER,
  audit_report JSONB,
  triggered_by UUID REFERENCES auth.users(id),
  
  -- Indexes
  INDEX idx_performance_audits_started_at ON performance_audits(started_at DESC),
  INDEX idx_performance_audits_status ON performance_audits(status),
  INDEX idx_performance_audits_environment ON performance_audits(environment)
);

-- Performance trends materialized view (updated hourly)
CREATE MATERIALIZED VIEW performance_trends_hourly AS
SELECT
  metric_name,
  component,
  environment,
  DATE_TRUNC('hour', timestamp) AS hour_bucket,
  COUNT(*) AS sample_count,
  AVG(metric_value) AS avg_value,
  MIN(metric_value) AS min_value,
  MAX(metric_value) AS max_value,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY metric_value) AS p95_value,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY metric_value) AS p99_value,
  STDDEV(metric_value) AS std_dev
FROM performance_metrics
WHERE timestamp >= NOW() - INTERVAL '7 days'
GROUP BY metric_name, component, environment, DATE_TRUNC('hour', timestamp')
WITH DATA;

-- Refresh function for materialized views
CREATE OR REPLACE FUNCTION refresh_performance_trends()
RETURNS TRIGGER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY performance_trends_hourly;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh views on new metrics (debounced)
CREATE TRIGGER refresh_trends_trigger
AFTER INSERT ON performance_metrics
FOR EACH STATEMENT
EXECUTE FUNCTION refresh_performance_trends();

-- RLS Policies
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_audits ENABLE ROW LEVEL SECURITY;

-- Policy: Team members can read all performance data
CREATE POLICY team_read_performance_metrics ON performance_metrics
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM team_members 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'developer', 'viewer')
    )
  );

-- Policy: Only admins can manage budgets
CREATE POLICY admin_manage_budgets ON performance_budgets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM team_members 
      WHERE user_id = auth.uid() 
      AND role = 'admin'
    )
  );

-- Policy: System service role can insert metrics (for monitoring scripts)
CREATE POLICY system_insert_performance_metrics ON performance_metrics
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Functions for common operations
CREATE OR REPLACE FUNCTION get_performance_summary(
  p_component VARCHAR,
  p_start_time TIMESTAMP WITH TIME ZONE,
  p_end_time TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE(
  metric_name VARCHAR,
  sample_count BIGINT,
  avg_value DOUBLE PRECISION,
  min_value DOUBLE PRECISION,
  max_value DOUBLE PRECISION,
  p95_value DOUBLE PRECISION,
  p99_value DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pm.metric_name,
    COUNT(*) as sample_count,
    AVG(pm.metric_value) as avg_value,
    MIN(pm.metric_value) as min_value,
    MAX(pm.metric_value) as max_value,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY pm.metric_value) as p95_value,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY pm.metric_value) as p99_value
  FROM performance_metrics pm
  WHERE pm.component = p_component
    AND pm.timestamp BETWEEN p_start_time AND p_end_time
  GROUP BY pm.metric_name
  ORDER BY sample_count DESC;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_performance_budget_violations()
RETURNS TABLE(
  budget_name VARCHAR,
  metric_name VARCHAR,
  component VARCHAR,
  current_value DOUBLE PRECISION,
  target_value DOUBLE PRECISION,
  violation_level VARCHAR,
  violation_time TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pb.budget_name,
    pb.metric_name,
    pb.component,
    latest.metric_value as current_value,
    pb.target_value,
    CASE
      WHEN pb.critical_threshold IS NOT NULL AND latest.metric_value > pb.critical_threshold THEN 'CRITICAL'
      WHEN pb.warning_threshold IS NOT NULL AND latest.metric_value > pb.warning_threshold THEN 'WARNING'
      ELSE 'WITHIN_BUDGET'
    END as violation_level,
    latest.timestamp as violation_time
  FROM performance_budgets pb
  CROSS JOIN LATERAL (
    SELECT metric_value, timestamp
    FROM performance_metrics pm
    WHERE pm.metric_name = pb.metric_name
      AND (pb.component IS NULL OR pm.component = pb.component)
      AND pm.environment = 'production'
    ORDER BY pm.timestamp DESC
    LIMIT 1
  ) latest
  WHERE pb.is_active = true
    AND (
      (pb.warning_threshold IS NOT NULL AND latest.metric_value > pb.warning_threshold)
      OR (pb.critical_threshold IS NOT NULL AND latest.metric_value > pb.critical_threshold)
    );
END;
$$ LANGUAGE plpgsql;

-- Performance dashboard view
CREATE VIEW performance_dashboard AS
WITH hourly_stats AS (
  SELECT
    metric_name,
    component,
    environment,
    DATE_TRUNC('hour', timestamp) as hour,
    AVG(metric_value) as avg_value,
    COUNT(*) as sample_count
  FROM performance_metrics
  WHERE timestamp >= NOW() - INTERVAL '24 hours'
  GROUP BY metric_name, component, environment, DATE_TRUNC('hour', timestamp)
),
current_alerts AS (
  SELECT
    COUNT(*) FILTER (WHERE severity = 'CRITICAL') as critical_alerts,
    COUNT(*) FILTER (WHERE severity = 'HIGH') as high_alerts,
    COUNT(*) FILTER (WHERE severity = 'MEDIUM') as medium_alerts,
    COUNT(*) FILTER (WHERE severity = 'LOW') as low_alerts
  FROM performance_alerts
  WHERE resolved_at IS NULL
    AND triggered_at >= NOW() - INTERVAL '1 hour'
),
budget_violations AS (
  SELECT COUNT(*) as violations_count
  FROM check_performance_budget_violations() cv
  WHERE cv.violation_level IN ('CRITICAL', 'WARNING')
)
SELECT
  -- Summary stats
  (SELECT COUNT(DISTINCT component) FROM performance_metrics WHERE timestamp >= NOW() - INTERVAL '1 hour') as active_components,
  (SELECT COUNT(DISTINCT metric_name) FROM performance_metrics WHERE timestamp >= NOW() - INTERVAL '1 hour') as tracked_metrics,
  (SELECT critical_alerts FROM current_alerts) as critical_alerts,
  (SELECT high_alerts FROM current_alerts) as high_alerts,
  (SELECT violations_count FROM budget_violations) as budget_violations,
  
  -- Recent metrics
  ARRAY(
    SELECT DISTINCT metric_name
    FROM performance_metrics
    WHERE timestamp >= NOW() - INTERVAL '5 minutes'
    ORDER BY metric_name
    LIMIT 10
  ) as recent_metrics,
  
  -- Slowest components
  ARRAY(
    SELECT component
    FROM (
      SELECT
        component,
        AVG(CASE WHEN metric_name = 'api_response_time' THEN metric_value END) as avg_response_time
      FROM performance_metrics
      WHERE timestamp >= NOW() - INTERVAL '1 hour'
        AND metric_name = 'api_response_time'
      GROUP BY component
      ORDER BY avg_response_time DESC
      LIMIT 5
    ) slow_components
  ) as slowest_components;

9.2 TypeScript Types for Performance Schema
typescript

// performance-types.ts
export interface PerformanceMetric {
  id: string;
  metric_name: string;
  metric_value: number;
  metric_unit: string;
  component: string;
  environment: 'development' | 'staging' | 'production';
  timestamp: Date;
  tags: Record<string, any>;
}

export interface PerformanceAlert {
  id: string;
  alert_type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  component?: string;
  metric_name?: string;
  metric_value?: number;
  threshold?: number;
  triggered_at: Date;
  acknowledged_at?: Date;
  acknowledged_by?: string;
  resolved_at?: Date;
  resolution_notes?: string;
}

export interface PerformanceBaseline {
  id: string;
  metric_name: string;
  component: string;
  environment: string;
  window_type: 'hourly' | 'daily' | 'weekly';
  statistical_metric: 'avg' | 'p95' | 'p99' | 'max' | 'min';
  baseline_value: number;
  standard_deviation?: number;
  calculated_at: Date;
  valid_from: Date;
  valid_to: Date;
}



  export interface PerformanceBudget {
  id: string;
  budget_name: string;
  metric_name: string;
  component?: string;
  target_value: number;
  warning_threshold?: number;
  critical_threshold?: number;
  timeframe: 'instant' | 'hourly' | 'daily' | 'weekly';
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string;
}

export interface PerformanceAudit {
  id: string;
  audit_type: 'scheduled' | 'manual' | 'deployment';
  status: 'running' | 'completed' | 'failed';
  environment: string;
  started_at: Date;
  completed_at?: Date;
  total_tests?: number;
  passed_tests?: number;
  failed_tests?: number;
  warnings?: number;
  audit_report?: any;
  triggered_by?: string;
}

export interface PerformanceTrend {
  metric_name: string;
  component: string;
  environment: string;
  hour_bucket: Date;
  sample_count: number;
  avg_value: number;
  min_value: number;
  max_value: number;
  p95_value: number;
  p99_value: number;
  std_dev: number;
}

// Performance monitoring configuration
export interface PerformanceMonitoringConfig {
  enabled: boolean;
  sampleRate: number;
  endpoints: string[];
  budgets: PerformanceBudget[];
  alerts: {
    enabled: boolean;
    thresholds: Record<string, number>;
    channels: string[];
  };
  reporting: {
    frequency: 'hourly' | 'daily' | 'weekly';
    recipients: string[];
  };
}
7.4 Performance Monitoring Dashboard

typescript
// components/PerformanceDashboard.tsx
import React, { useState, useEffect } from 'react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { createClient } from '@supabase/supabase-js';
import { PerformanceMetric, PerformanceAlert, PerformanceTrend } from '../performance-types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const PerformanceDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [alerts, setAlerts] = useState<PerformanceAlert[]>([]);
  const [trends, setTrends] = useState<PerformanceTrend[]>([]);
  const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h');
  const [loading, setLoading] = useState(true);
  const [selectedComponent, setSelectedComponent] = useState<string>('all');

  useEffect(() => {
    fetchPerformanceData();
  }, [timeRange, selectedComponent]);

  const fetchPerformanceData = async () => {
    setLoading(true);
    try {
      // Calculate time range
      const now = new Date();
      let startTime: Date;
      
      switch (timeRange) {
        case '1h':
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case '24h':
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
      }

      // Fetch metrics
      let metricsQuery = supabase
        .from('performance_metrics')
        .select('*')
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', now.toISOString())
        .order('timestamp', { ascending: true });
      
      if (selectedComponent !== 'all') {
        metricsQuery = metricsQuery.eq('component', selectedComponent);
      }
      
      const { data: metricsData } = await metricsQuery;
      setMetrics(metricsData || []);

      // Fetch alerts
      const { data: alertsData } = await supabase
        .from('performance_alerts')
        .select('*')
        .gte('triggered_at', startTime.toISOString())
        .lte('triggered_at', now.toISOString())
        .order('triggered_at', { ascending: false });
      
      setAlerts(alertsData || []);

      // Fetch trends
      const { data: trendsData } = await supabase
        .from('performance_trends_hourly')
        .select('*')
        .gte('hour_bucket', startTime.toISOString())
        .lte('hour_bucket', now.toISOString())
        .order('hour_bucket', { ascending: true });
      
      setTrends(trendsData || []);
    } catch (error) {
      console.error('Error fetching performance data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Process data for charts
  const responseTimeData = trends
    .filter(trend => trend.metric_name === 'api_response_time')
    .map(trend => ({
      time: new Date(trend.hour_bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      avg: trend.avg_value,
      p95: trend.p95_value,
      p99: trend.p99_value,
    }));

  const errorRateData = trends
    .filter(trend => trend.metric_name === 'error_rate')
    .map(trend => ({
      time: new Date(trend.hour_bucket).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      rate: trend.avg_value * 100,
    }));

  const componentData = Object.entries(
    metrics.reduce((acc, metric) => {
      acc[metric.component] = (acc[metric.component] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([component, count]) => ({
    name: component,
    value: count,
  }));

  const alertSeverityData = [
    { name: 'Critical', value: alerts.filter(a => a.severity === 'CRITICAL').length, color: '#ef4444' },
    { name: 'High', value: alerts.filter(a => a.severity === 'HIGH').length, color: '#f97316' },
    { name: 'Medium', value: alerts.filter(a => a.severity === 'MEDIUM').length, color: '#eab308' },
    { name: 'Low', value: alerts.filter(a => a.severity === 'LOW').length, color: '#22c55e' },
  ].filter(item => item.value > 0);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">Loading performance data...</div>;
  }

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Performance Dashboard</h1>
        <p className="text-gray-600">Monitor system performance and identify bottlenecks</p>
      </div>

      {/* Controls */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="flex flex-wrap gap-4">
          <div>
            <label htmlFor="timeRange" className="block text-sm font-medium text-gray-700 mb-1">
              Time Range
            </label>
            <select
              id="timeRange"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as any)}
              className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1h">Last Hour</option>
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
          </div>
          <div>
            <label htmlFor="component" className="block text-sm font-medium text-gray-700 mb-1">
              Component
            </label>
            <select
              id="component"
              value={selectedComponent}
              onChange={(e) => setSelectedComponent(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Components</option>
              <option value="api">API</option>
              <option value="database">Database</option>
              <option value="cache">Cache</option>
              <option value="frontend">Frontend</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchPerformanceData}
              className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Avg Response Time</h3>
          <p className="text-3xl font-bold text-blue-600">
            {responseTimeData.length > 0 
              ? `${responseTimeData.reduce((sum, item) => sum + item.avg, 0) / responseTimeData.length | 0}ms`
              : 'N/A'}
          </p>
          <p className="text-sm text-gray-600">Last {timeRange === '1h' ? 'hour' : timeRange.replace('d', ' days')}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Error Rate</h3>
          <p className="text-3xl font-bold text-red-600">
            {errorRateData.length > 0 
              ? `${(errorRateData.reduce((sum, item) => sum + item.rate, 0) / errorRateData.length).toFixed(2)}%`
              : 'N/A'}
          </p>
          <p className="text-sm text-gray-600">Last {timeRange === '1h' ? 'hour' : timeRange.replace('d', ' days')}</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Active Alerts</h3>
          <p className="text-3xl font-bold text-orange-600">{alerts.length}</p>
          <p className="text-sm text-gray-600">Requiring attention</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Components Monitored</h3>
          <p className="text-3xl font-bold text-green-600">{componentData.length}</p>
          <p className="text-sm text-gray-600">Currently tracked</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">API Response Time</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={responseTimeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="avg" stroke="#3b82f6" strokeWidth={2} dot={false} name="Average" />
              <Line type="monotone" dataKey="p95" stroke="#f97316" strokeWidth={2} dot={false} name="95th Percentile" />
              <Line type="monotone" dataKey="p99" stroke="#ef4444" strokeWidth={2} dot={false} name="99th Percentile" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Error Rate</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={errorRateData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="rate" stroke="#ef4444" fill="#fca5a5" name="Error Rate (%)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Component Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={componentData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {componentData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'][index % 5]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Alert Severity</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={alertSeverityData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {alertSeverityData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Alerts Table */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Recent Alerts</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Severity
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Component
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Message
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Triggered
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {alerts.slice(0, 10).map((alert) => (
                <tr key={alert.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                      alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-800' :
                      alert.severity === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {alert.component || 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {alert.message}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(alert.triggered_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      alert.resolved_at ? 'bg-green-100 text-green-800' :
                      alert.acknowledged_at ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {alert.resolved_at ? 'Resolved' :
                       alert.acknowledged_at ? 'Acknowledged' :
                       'Open'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {alerts.length === 0 && (
            <div className="px-6 py-4 text-center text-gray-500">
              No alerts in the selected time range
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
7.5 Performance Optimization Checklist

markdown
# Performance Optimization Checklist

## Pre-Deployment Checklist

### Frontend Optimization
- [ ] Bundle size under 200KB (gzipped)
- [ ] Lighthouse performance score > 90
- [ ] First Contentful Paint < 1.5s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Time to Interactive < 3.5s
- [ ] Cumulative Layout Shift < 0.1
- [ ] Total Blocking Time < 200ms
- [ ] Images optimized (WebP, AVIF formats)
- [ ] Lazy loading implemented for images and components
- [ ] Code splitting implemented for route-based chunks
- [ ] Service worker configured for caching
- [ ] Critical CSS inlined
- [ ] Font loading optimized
- [ ] Third-party scripts minimized
- [ ] Unused CSS/JS removed

### Backend Optimization
- [ ] API response times < 200ms (95th percentile)
- [ ] Database query times < 100ms (95th percentile)
- [ ] Cache hit rate > 80%
- [ ] Memory usage < 80% of allocated limit
- [ ] CPU utilization < 70% under normal load
- [ ] Connection pooling implemented
- [ ] Request batching implemented where appropriate
- [ ] Pagination implemented for large datasets
- [ ] Rate limiting configured
- [ ] Compression enabled (gzip/brotli)
- [ ] CDN configured for static assets
- [ ] Database indexes optimized
- [ ] N+1 query problems eliminated

### Security & Reliability
- [ ] Security headers configured
- [ ] Input validation implemented
- [ ] Output encoding implemented
- [ ] Authentication flows optimized
- [ ] Error handling implemented
- [ ] Retry logic with exponential backoff
- [ ] Circuit breakers implemented
- [ ] Health check endpoints implemented
- [ ] Monitoring and alerting configured
- [ ] Log aggregation configured
- [ ] Error tracking configured
- [ ] Performance monitoring configured

### Testing & Quality Assurance
- [ ] Unit test coverage > 80%
- [ ] Integration tests for critical paths
- [ ] End-to-end tests for user journeys
- [ ] Performance tests for peak load
- [ ] Load tests for scalability
- [ ] Security tests for vulnerabilities
- [ ] Accessibility tests for WCAG compliance
- [ ] Cross-browser compatibility tests
- [ ] Mobile responsiveness tests
- [ ] Error handling tests
- [ ] Failover tests
- [ ] Recovery tests

## Post-Deployment Monitoring

### Immediate Checks (First Hour)
- [ ] Error rate < 1%
- [ ] Response times within SLA
- [ ] No critical alerts
- [ ] Database performance stable
- [ ] Cache hit rate > 80%
- [ ] Memory usage < 80%
- [ ] CPU utilization < 70%
- [ ] No user-reported issues

### Short-term Monitoring (First 24 Hours)
- [ ] Performance metrics stable
- [ ] No regression in user experience
- [ ] Error rate remains low
- [ ] Database queries performant
- [ ] Third-party integrations working
- [ ] Scheduled tasks running
- [ ] Backups completed successfully
- [ ] Monitoring alerts working

### Long-term Monitoring (First Week)
- [ ] Performance trends analyzed
- [ ] User feedback collected
- [ ] A/B test results evaluated
- [ ] Cost optimization reviewed
- [ ] Scaling needs assessed
- [ ] Documentation updated
- [ ] Team retrospective conducted
- [ ] Lessons learned documented
7.6 Final Optimization Steps

typescript
// scripts/optimize.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';

interface OptimizationStep {
  name: string;
  description: string;
  execute: () => Promise<{ success: boolean; message: string; metrics?: Record<string, number> }>;
}

class PerformanceOptimizer {
  private steps: OptimizationStep[] = [
    {
      name: 'Bundle Analysis',
      description: 'Analyze bundle size and identify optimization opportunities',
      execute: async () => {
        try {
          execSync('npm run build -- --analyze', { stdio: 'pipe' });
          return {
            success: true,
            message: 'Bundle analysis completed. Check .next/analyze for details.',
          };
        } catch (error) {
          return {
            success: false,
            message: `Bundle analysis failed: ${error.message}`,
          };
        }
      },
    },
    {
      name: 'Image Optimization',
      description: 'Optimize images for web formats',
      execute: async () => {
        try {
          // This would run your image optimization script
          execSync('npm run optimize:images', { stdio: 'pipe' });
          return {
            success: true,
            message: 'Images optimized successfully',
          };
        } catch (error) {
          return {
            success: false,
            message: `Image optimization failed: ${error.message}`,
          };
        }
      },
    },
    {
      name: 'Database Index Optimization',
      description: 'Optimize database indexes for better query performance',
      execute: async () => {
        try {
          // This would run your database optimization script
          execSync('npm run db:optimize', { stdio: 'pipe' });
          return {
            success: true,
            message: 'Database indexes optimized',
          };
        } catch (error) {
          return {
            success: false,
            message: `Database optimization failed: ${error.message}`,
          };
        }
      },
    },
    {
      name: 'Cache Warming',
      description: 'Warm up caches with frequently accessed data',
      execute: async () => {
        try {
          // This would run your cache warming script
          execSync('npm run cache:warm', { stdio: 'pipe' });
          return {
            success: true,
            message: 'Cache warmed successfully',
          };
        } catch (error) {
          return {
            success: false,
            message: `Cache warming failed: ${error.message}`,
          };
        }
      },
    },
    {
      name: 'Performance Audit',
      description: 'Run comprehensive performance audit',
      execute: async () => {
        try {
          // Import and run the performance auditor
          const { auditor } = await import('./performance-audit');
          const results = await auditor.runFullAudit();
          
          const passed = results.filter(r => r.status === 'PASS').length;
          const warnings = results.filter(r => r.status === 'WARN').length;
          const failed = results.filter(r => r.status === 'FAIL').length;
          
          return {
            success: failed === 0,
            message: `Performance audit completed: ${passed} passed, ${warnings} warnings, ${failed} failed`,
            metrics: { passed, warnings, failed },
          };
        } catch (error) {
          return {
            success: false,
            message: `Performance audit failed: ${error.message}`,
          };
        }
      },
    },
  ];

  async runOptimizations(): Promise<void> {
    console.log('🚀 Starting performance optimization...');
    
    const results = [];
    const startTime = performance.now();
    
    for (const step of this.steps) {
      console.log(`\n📋 Running: ${step.name}`);
      console.log(`   ${step.description}`);
      
      const stepStartTime = performance.now();
      const result = await step.execute();
      const stepDuration = performance.now() - stepStartTime;
      
      results.push({
        step: step.name,
        ...result,
        duration: stepDuration,
      });
      
      if (result.success) {
        console.log(`✅ ${step.name} completed in ${(stepDuration / 1000).toFixed(2)}s`);
        console.log(`   ${result.message}`);
        
        if (result.metrics) {
          console.log(`   Metrics: ${JSON.stringify(result.metrics)}`);
        }
      } else {
        console.log(`❌ ${step.name} failed in ${(stepDuration / 1000).toFixed(2)}s`);
        console.log(`   ${result.message}`);
      }
    }
    
    const totalDuration = performance.now() - startTime;
    const successfulSteps = results.filter(r => r.success).length;
    
    console.log('\n📊 Optimization Summary:');
    console.log(`   Total time: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`   Successful steps: ${successfulSteps}/${results.length}`);
    
    // Generate report
    this.generateReport(results, totalDuration);
    
    console.log('\n✅ Performance optimization completed');
  }

  private generateReport(results: any[], totalDuration: number): void {
    const report = {
      timestamp: new Date().toISOString(),
      totalDuration,
      results,
      summary: {
        totalSteps: results.length,
        successfulSteps: results.filter(r => r.success).length,
        failedSteps: results.filter(r => !r.success).length,
      },
    };
    
    const reportPath = path.join(process.cwd(), 'optimization-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Report saved to: ${reportPath}`);
  }
}

// CLI interface
if (require.main === module) {
  const optimizer = new PerformanceOptimizer();
  optimizer.runOptimizations()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Optimization failed:', error);
      process.exit(1);
    });
}






