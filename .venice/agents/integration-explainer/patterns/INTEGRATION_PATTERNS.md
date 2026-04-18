# INTEGRATION PATTERN LIBRARY

## OVERVIEW
This library catalogs common integration patterns for the complete technology stack. Each pattern includes implementation details, security considerations, performance optimizations, and troubleshooting guides.

---

## 1. WALLETCONNECT V1/V2 INTEGRATION PATTERNS

### Pattern 1.1: Mobile Deep Linking with Session Persistence
**Use Case**: Connect mobile wallets to web applications with persistent sessions
**Complexity**: Medium
**Security Risk**: High (private key exposure)

**Implementation**:
```typescript
// WalletConnect v2 with encrypted session storage
import { Web3Modal } from '@web3modal/standalone'
import { EthereumProvider } from '@walletconnect/ethereum-provider'
import CryptoJS from 'crypto-js'

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
const sessionStorageKey = 'wc_session_v2'

const web3Modal = new Web3Modal({
  projectId,
  walletConnectVersion: 2,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-z-index': 1000
  }
})

// Encrypt session data before storing
const encryptSession = (session: any, secret: string) => {
  return CryptoJS.AES.encrypt(JSON.stringify(session), secret).toString()
}

// Decrypt session data
const decryptSession = (encrypted: string, secret: string) => {
  const bytes = CryptoJS.AES.decrypt(encrypted, secret)
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8))
}

export class WalletConnectService {
  private provider: EthereumProvider | null = null
  private sessionSecret: string

  constructor() {
    this.sessionSecret = process.env.NEXT_PUBLIC_SESSION_SECRET!
  }

  async connect() {
    this.provider = await EthereumProvider.init({
      projectId,
      chains: [1], // Ethereum mainnet
      showQrModal: true,
      methods: ['eth_sendTransaction', 'personal_sign'],
      events: ['chainChanged', 'accountsChanged']
    })

    // Try to restore existing session
    const encryptedSession = localStorage.getItem(sessionStorageKey)
    if (encryptedSession) {
      try {
        const session = decryptSession(encryptedSession, this.sessionSecret)
        await this.provider.connect({
          pairingTopic: session.pairingTopic,
          requiredNamespaces: session.requiredNamespaces
        })
      } catch (error) {
        console.warn('Failed to restore session:', error)
        localStorage.removeItem(sessionStorageKey)
      }
    }

    if (!this.provider.session) {
      await this.provider.connect()
      const session = this.provider.session
      const encrypted = encryptSession(session, this.sessionSecret)
      localStorage.setItem(sessionStorageKey, encrypted)
    }

    return this.provider
  }

  async disconnect() {
    if (this.provider) {
      await this.provider.disconnect()
      localStorage.removeItem(sessionStorageKey)
    }
  }
}
```

**Security Considerations**:
- Never store private keys or seed phrases in localStorage
- Use encryption for session data
- Implement session timeout (recommended: 24 hours)
- Validate wallet messages before signing
- Use `localStorage` for mobile, `sessionStorage` for desktop

**Performance Optimizations**:
- Lazy load WalletConnect SDK
- Implement connection pooling for multiple chains
- Cache wallet information
- Use WebSocket keep-alive for persistent connections

**Troubleshooting**:
```
Common Issues:
1. "QR code not scanning" → Ensure deep linking configured in wallet
2. "Session not persisting" → Check encryption/decryption keys match
3. "Mobile deep link not opening" → Verify universal links configuration
4. "Connection timeout" → Increase timeout to 30 seconds
```

---

## 2. ERC-721 SMART CONTRACT WITH PINATA IPFS

### Pattern 2.1: NFT Minting with Dynamic Metadata
**Use Case**: Mint NFTs with metadata stored on IPFS
**Complexity**: High
**Security Risk**: Medium (contract vulnerabilities)

**Implementation**:
```solidity
// ERC-721 with IPFS metadata
// SPDX-License-Identifier: MIT
pragma solidity .8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract DynamicNFT is ERC721, Ownable {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIdCounter;
    
    mapping(uint256 => string) private _tokenURIs;
    mapping(uint256 => address) private _tokenCreators;
    
    string public baseExtension = ".json";
    uint256 public maxSupply = 10000;
    uint256 public mintPrice = 0.05 ether;
    
    event NFTMinted(uint256 indexed tokenId, address indexed creator, string tokenURI);
    event MetadataUpdated(uint256 indexed tokenId, string newTokenURI);
    
    constructor() ERC721("DynamicNFT", "DNFT") Ownable(msg.sender) {}
    
    function mintNFT(string memory tokenURI) external payable {
        require(msg.value >= mintPrice, "Insufficient payment");
        require(_tokenIdCounter.current() < maxSupply, "Max supply reached");
        
        uint256 tokenId = _tokenIdCounter.current();
        _tokenIdCounter.increment();
        
        _safeMint(msg.sender, tokenId);
        _setTokenURI(tokenId, tokenURI);
        _tokenCreators[tokenId] = msg.sender;
        
        payable(owner()).transfer(msg.value);
        
        emit NFTMinted(tokenId, msg.sender, tokenURI);
    }
    
    function updateTokenURI(uint256 tokenId, string memory newTokenURI) external {
        require(_exists(tokenId), "Token does not exist");
        require(
            msg.sender == ownerOf(tokenId) || msg.sender == _tokenCreators[tokenId],
            "Not authorized"
        );
        
        _setTokenURI(tokenId, newTokenURI);
        emit MetadataUpdated(tokenId, newTokenURI);
    }
    
    function _setTokenURI(uint256 tokenId, string memory tokenURI) internal {
        _tokenURIs[tokenId] = tokenURI;
    }
    
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");
        return _tokenURIs[tokenId];
    }
    
    function getCreator(uint256 tokenId) external view returns (address) {
        return _tokenCreators[tokenId];
    }
    
    function setMintPrice(uint256 newPrice) external onlyOwner {
        mintPrice = newPrice;
    }
    
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
```

**Pinata Integration**:
```typescript
// Pinata IPFS upload service
import axios from 'axios'
import { create } from 'ipfs-http-client'

const PINATA_API_KEY = process.env.PINATA_API_KEY
const PINATA_SECRET_API_KEY = process.env.PINATA_SECRET_API_KEY
const PINATA_JWT = process.env.PINATA_JWT

export class PinataService {
  private client: any
  
  constructor() {
    this.client = create({
      host: 'api.pinata.cloud',
      port: 443,
      protocol: 'https',
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET_API_KEY,
        Authorization: `Bearer ${PINATA_JWT}`
      }
    })
  }
  
  async uploadMetadata(metadata: any): Promise<string> {
    const data = JSON.stringify({
      pinataContent: metadata,
      pinataMetadata: {
        name: `nft-metadata-${Date.now()}.json`
      }
    })
    
    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      data,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PINATA_JWT}`
        }
      }
    )
    
    return `ipfs://${response.data.IpfsHash}`
  }
  
  async uploadFile(file: File): Promise<string> {
    const formData = new FormData()
    formData.append('file', file)
    
    const metadata = JSON.stringify({
      name: file.name,
      keyvalues: {
        type: 'nft-asset'
      }
    })
    formData.append('pinataMetadata', metadata)
    
    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${PINATE_JWT}`
        }
      }
    )
    
    return `ipfs://${response.data.IpfsHash}`
  }
}
```

**Security Considerations**:
- Use OpenZeppelin contracts for security
- Implement access control with Ownable/Roles
- Validate all user inputs
- Use reentrancy guards for payable functions
- Test thoroughly on testnet before mainnet

**Performance Optimizations**:
- Batch minting for multiple NFTs
- Use deterministic token IDs for gas savings
- Implement royalty standards (ERC-2981)
- Use IPFS gateways for faster metadata retrieval

**Troubleshooting**:
```
Common Issues:
1. "Transaction reverting" → Check gas limits and contract permissions
2. "IPFS hash not resolving" → Verify Pinata API keys and CORS settings
3. "Metadata not displaying" → Ensure proper JSON format and CORS headers
4. "High gas costs" → Optimize contract storage and batch operations
```

---

## 3. VERCEL IMAGE BLOB WITH NEXT.JS 15

### Pattern 3.1: Optimized Image Upload and Processing
**Use Case**: Upload, optimize, and serve images via Vercel Blob
**Complexity**: Medium
**Security Risk**: Low (with proper validation)

**Implementation**:
```typescript
// Next.js 15 App Router with Vercel Blob
import { put } from '@vercel/blob'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'edge'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('image') as File
    
    if (!file) {
      return NextResponse.json(
        { error: 'No image provided' },
        { status: 400 }
      )
    }
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type' },
        { status: 400 }
      )
    }
    
    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File too large' },
        { status: 400 }
      )
    }
    
    // Optimize image with sharp
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    const optimizedImage = await sharp(buffer)
      .resize(1200, 800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    
    // Generate unique filename
    const fileName = `${uuidv4()}.webp`
    
    // Upload to Vercel Blob
    const { url } = await put(fileName, optimizedImage, {
      access: 'public',
      contentType: 'image/webp'
    })
    
    // Generate responsive image URLs
    const imageUrls = {
      original: url,
      thumbnail: url.replace('.webp', '-thumb.webp'),
      medium: url.replace('.webp', '-medium.webp'),
      large: url.replace('.webp', '-large.webp')
    }
    
    return NextResponse.json({
      success: true,
      urls: imageUrls,
      metadata: {
        fileName,
        fileSize: optimizedImage.length,
        contentType: 'image/webp',
        uploadedAt: new Date().toISOString()
      }
    })
    
  } catch (error) {
    console.error('Image upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    )
  }
}
```

**Next.js Image Component Integration**:
```tsx
// Optimized image display component
import Image from 'next/image'
import { getPlaiceholder } from 'plaiceholder'

interface OptimizedImageProps {
  src: string
  alt: string
  width: number
  height: number
  priority?: boolean
}

export async function OptimizedImage({ 
  src, alt, width, height, priority = false 
}: OptimizedImageProps) {
  // Generate blur placeholder
  const buffer = await fetch(src).then(async (res) =>
    Buffer.from(await res.arrayBuffer())
  )
  
  const { base64 } = await getPlaiceholder(buffer)
  
  return (
    <div className="relative overflow-hidden rounded-lg">
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        placeholder="blur"
        blurDataURL={base64}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        className="object-cover transition-all duration-300 hover:scale-105"
      />
    </div>
  )
}
```

**Security Considerations**:
- Validate file types and sizes
- Sanitize filenames to prevent path traversal
- Implement rate limiting
- Use signed URLs for sensitive images
- Set appropriate CORS headers

**Performance Optimizations**:
- Use WebP/AVIF format for better compression
- Implement lazy loading for images below the fold
- Use Next.js Image component for automatic optimization
- Implement CDN caching headers
- Generate blur placeholders for better UX

**Troubleshooting**:
```
Common Issues:
1. "Upload failing" → Check Vercel Blob token permissions
2. "Images not displaying" → Verify CORS configuration
3. "Slow image loading" → Implement proper image sizing and formats
4. "Storage quota exceeded" → Monitor blob storage usage
```

---

## 4. FARCASTER + NEYNAR SOCIAL INTEGRATION

### Pattern 4.1: Social Feed with Real-time Updates
**Use Case**: Display Farcaster casts with user interactions
**Complexity**: Medium
**Security Risk**: Medium (API rate limits, data validation)

**Implementation**:
```typescript
// Combined Farcaster SDK + Neynar API integration
import { NeynarAPIClient } from "@neynar/nodejs-sdk"
import { 
  FarcasterNetwork,
  getSSLHubRpcClient,
  makeUserDataAdd,
  Message,
  UserDataType
} from "@farcaster/hub-web"
import { Wallet } from "ethers"

export class SocialService {
  private neynarClient: NeynarAPIClient
  private hubClient: ReturnType<typeof getSSLHubRpcClient>
  private wallet: Wallet
  
  constructor() {
    this.neynarClient = new NeynarAPIClient(
      process.env.NEYNAR_API_KEY!
    )
    
    this.hubClient = getSSLHubRpcClient(
      process.env.HUB_RPC_URL || "nemes.farcaster.xyz:2283"
    )
    
    this.wallet = new Wallet(process.env.FARCASTER_PRIVATE_KEY!)
  }
  
  // Fetch feed with Neynar (better for data aggregation)
  async getFeed(options: {
    feedType?: 'following' | 'filter' | 'global'
    limit?: number
    cursor?: string
  }) {
    const { feedType = 'following', limit = 50, cursor } = options
    
    try {
      const feed = await this.neynarClient.fetchFeed({
        feedType,
        filterType: 'global',
        limit,
        cursor,
        withRecasts: true,
        withReplies: true
      })
      
      return {
        casts: feed.casts,
        nextCursor: feed.next.cursor,
        hasMore: feed.next.cursor !== null
      }
    } catch (error) {
      console.error('Failed to fetch feed:', error)
      
      // Fallback to Farcaster Hub
      return this.getFeedFromHub(limit)
    }
  }
  
  // Fallback to Farcaster Hub (more real-time)
  async getFeedFromHub(limit: number) {
    const casts = await this.hubClient.getCasts({
      pageSize: limit,
      reverse: true
    })
    
    return {
      casts: casts.messages.map(msg => msg.data),
      nextCursor: null,
      hasMore: false
    }
  }
  
  // Post a cast with both APIs
  async postCast(text: string, options?: {
    parentUrl?: string
    embeds?: string[]
    channelId?: string
  }) {
    // Post via Neynar (supports channels, embeds)
    const neynarCast = await this.neynarClient.publishCast(
      this.wallet,
      text,
      {
        parentUrl: options?.parentUrl,
        embeds: options?.embeds,
        channelId: options?.channelId
      }
    )
    
    // Also post directly to Hub for redundancy
    const castAdd = await makeUserDataAdd(
      {
        fid: parseInt(process.env.FARCASTER_FID!),
        network: FarcasterNetwork.MAINNET
      },
      UserDataType.USER_DATA_TYPE_PFP,
      text,
      this.wallet
    )
    
    await this.hubClient.submitMessage(castAdd.message as Message)
    
    return {
      neynarHash: neynarCast.hash,
      hubMessage: castAdd.message
    }
  }
  
  // Real-time updates via Hub WebSocket
  setupRealtimeListener(callback: (cast: any) => void) {
    const hubWebSocket = new WebSocket(
      process.env.HUB_WS_URL || 'wss://nemes.farcaster.xyz:2284'
    )
    
    hubWebSocket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'cast_add') {
        callback(data.cast)
      }
    }
    
    return () => hubWebSocket.close()
  }
}
```

**Security Considerations**:
- Validate all user input before posting
- Implement rate limiting for API calls
- Store API keys securely using environment variables
- Sanitize cast content to prevent XSS
- Use HTTPS for all API calls

**Performance Optimizations**:
- Cache feed data with Redis/Vercel KV
- Implement pagination for large feeds
- Use WebSocket for real-time updates only when needed
- Batch API calls where possible
- Use CDN for static media (pfp, banners)

**Troubleshooting**:
```
Common Issues:
1. "API rate limit exceeded" → Implement exponential backoff
2. "Cast not appearing" → Check Hub synchronization status
3. "WebSocket connection drops" → Implement reconnection logic
4. "Invalid signature" → Verify private key and FID match
```

---

## 5. COINBASE ONCHAINKIT SDK INTEGRATION

### Pattern 5.1: Multi-chain Wallet Operations
**Use Case**: Perform transactions across multiple chains
**Complexity**: High
**Security Risk**: High (transaction signing)

**Implementation**:
```typescript
// Multi-chain wallet operations with onChainKit
import { OnChainKitProvider, useOnChainKit } from '@onchainkit/onchainkit'
import { base, mainnet, polygon, optimism, arbitrum } from '@onchainkit/chains'
import { createPublicClient, createWalletClient, custom, http } from 'viem'
import { parseEther, formatEther } from 'viem/utils'

export class OnChainKitService {
  private walletClient: any
  private publicClients: Map<number, any> = new Map()
  
  constructor() {
    // Initialize public clients for all supported chains
    const chains = [
      { id: base.id, client: createPublicClient({ chain: base, transport: http() }) },
      { id: mainnet.id, client: createPublicClient({ chain: mainnet, transport: http() }) },
      { id: polygon.id, client: createPublicClient({ chain: polygon, transport: http() }) },
      { id: optimism.id, client: createPublicClient({ chain: optimism, transport: http() }) },
      { id: arbitrum.id, client: createPublicClient({ chain: arbitrum, transport: http() }) }
    ]
    
    chains.forEach(({ id, client }) => {
      this.publicClients.set(id, client)
    })
  }
  
  async initializeWallet() {
    if (typeof window !== 'undefined' && window.ethereum) {
      this.walletClient = createWalletClient({
        chain: base,
        transport: custom(window.ethereum)
      })
    }
  }
  
  async switchChain(chainId: number) {
    if (!this.walletClient) throw new Error('Wallet not initialized')
    
    try {
      await this.walletClient.switchChain({ id: chainId })
      return true
    } catch (error) {
      console.error('Failed to switch chain:', error)
      return false
    }
  }
  
  async sendTransaction(options: {
    to: `0x${string}`
    value: string
    chainId: number
    data?: `0x${string}`
  }) {
    if (!this.walletClient) throw new Error('Wallet not initialized')
    
    const [address] = await this.walletClient.getAddresses()
    
    const transaction = {
      account: address,
      to: options.to,
      value: parseEther(options.value),
      data: options.data,
      chain: this.getChainById(options.chainId)
    }
    
    const hash = await this.walletClient.sendTransaction(transaction)
    
    // Wait for confirmation
    const publicClient = this.publicClients.get(options.chainId)
    if (publicClient) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      return {
        hash,
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      }
    }
    
    return { hash, status: 'pending' }
  }
  
  async signMessage(message: string) {
    if (!this.walletClient) throw new Error('Wallet not initialized')
    
    const [address] = await this.walletClient.getAddresses()
    const signature = await this.walletClient.signMessage({
      account: address,
      message
    })
    
    return { address, signature, message }
  }
  
  async getBalances(address: `0x${string}`) {
    const balances: Record<string, string> = {}
    
    for (const [chainId, client] of this.publicClients.entries()) {
      try {
        const balance = await client.getBalance({ address })
        balances[chainId.toString()] = formatEther(balance)
      } catch (error) {
        console.warn(`Failed to get balance for chain ${chainId}:`, error)
        balances[chainId.toString()] = '0'
      }
    }
    
    return balances
  }
  
  private getChainById(chainId: number) {
    const chains = { base, mainnet, polygon, optimism, arbitrum }
    return Object.values(chains).find(chain => chain.id === chainId) || base
  }
}
```

**Security Considerations**:
- Always validate addresses before sending transactions
- Use typed data (EIP-712) for structured signing
- Implement transaction simulation before sending
- Show gas estimates and confirmations
- Warn users about phishing attempts

**Performance Optimizations**:
- Batch balance queries
- Cache chain data and token lists
- Use multicall for multiple view functions
- Implement transaction queuing
- Use optimistic updates for better UX

**Troubleshooting**:
```
Common Issues:
1. "Chain not supported" → Check chain configuration
2. "Insufficient funds" → Check balance before transaction
3. "Transaction stuck" → Check gas prices and nonce
4. "Wrong network" → Ensure wallet is on correct chain
```

---

## 6. TAILWIND CSS + SHADCN/UI ARCHITECTURE

### Pattern 6.1: Component Library with Design Tokens
**Use Case**: Consistent, accessible UI components
**Complexity**: Low
**Security Risk**: Low (CSS injection prevention)

**Implementation**:
```typescript
// Design tokens configuration
// tailwind.config.ts
import type { Config } from 'tailwindcss'
import { fontFamily } from 'tailwindcss/defaultTheme'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', ...fontFamily.sans],
        mono: ['var(--font-mono)', ...fontFamily.mono],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
```

**CSS Variables for theming**:
```css
/* globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 221.2 83.2% 53.3%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 224.3 76.3% 48%;
  }
}
```

**Security Considerations**:
- Sanitize user-generated content in tooltips/popovers
- Prevent CSS injection through proper escaping
- Use CSP headers to restrict inline styles
- Validate CSS custom property values

**Performance Optimizations**:
- Use PurgeCSS/Tailwind's JIT compiler
- Implement critical CSS extraction
- Use CSS containment for complex components
- Optimize animations with `will-change`
- Implement virtualized lists for large datasets

**Troubleshooting**:
```
Common Issues:
1. "Styles not applying" → Check JIT mode and content paths
2. "Dark mode not working" → Verify class-based dark mode setup
3. "CSS variables undefined" → Check :root declaration order
4. "Build size too large" → Enable PurgeCSS and tree shaking
```

—

7. NEXT.JS 15 APP ROUTER PATTERNS

Pattern 7.1: Parallel Routes with Loading States
Use Case: Complex layouts with independent loading
Complexity: Medium
Security Risk: Low (route protection needed)

Implementation:
```typescript
// app/layout.tsx - Parallel routes layout
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Suspense } from 'react'
import LoadingSkeleton from '@/components/loading-skeleton'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Multi-Agent Platform',
  description: 'Next.js 15 with parallel routes',
}

export default function RootLayout({
  children,
  sidebar,
  header,
  analytics,
}: {
  children: React.ReactNode
  sidebar: React.ReactNode
  header: React.ReactNode
  analytics: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-background">
        {/* Header slot */}
        <Suspense fallback={<LoadingSkeleton type="header" />}>
          {header}
        </Suspense>
        
        <div className="flex">
          {/* Sidebar slot */}
          <aside className="w-64 border-r">
            <Suspense fallback={<LoadingSkeleton type="sidebar" />}>
              {sidebar}
            </Suspense>
          </aside>
          
          {/* Main content */}
          <main className="flex-1 p-6">
            <Suspense fallback={<LoadingSkeleton type="content" />}>
              {children}
            </Suspense>
          </main>
        </div>
        
        {/* Analytics slot */}
        <Suspense fallback={null}>
          {analytics}
        </Suspense>
      </body>
    </html>
  )
}
```

**Route Groups with Suspense Boundaries**:
```typescript
// app/(marketing)/layout.tsx - Marketing route group
import { MarketingHeader } from '@/components/marketing-header'
import { MarketingFooter } from '@/components/marketing-footer'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="marketing-layout">
      <MarketingHeader />
      <main className="marketing-content">
        {children}
      </main>
      <MarketingFooter />
    </div>
  )
}

// app/(app)/layout.tsx - App route group
import { AppSidebar } from '@/components/app-sidebar'
import { AppHeader } from '@/components/app-header'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="app-layout">
      <AppHeader />
      <div className="flex">
        <AppSidebar />
        <div className="flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
```

**Server Actions with Revalidation**:
```typescript
// app/actions/todos.ts
'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerClient } from '@/utils/supabase-server'

export async function createTodo(formData: FormData) {
  const supabase = createServerClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/login')
  }
  
  const title = formData.get('title') as string
  const description = formData.get('description') as string
  
  const { error } = await supabase
    .from('todos')
    .insert({
      title,
      description,
      user_id: user.id,
      completed: false
    })
  
  if (error) {
    return {
      success: false,
      error: error.message
    }
  }
  
  revalidatePath('/todos')
  
  return {
    success: true,
    message: 'Todo created successfully'
  }
}

export async function updateTodo(id: string, formData: FormData) {
  const supabase = createServerClient()
  
  const title = formData.get('title') as string
  const description = formData.get('description') as string
  const completed = formData.get('completed') === 'true'
  
  const { error } = await supabase
    .from('todos')
    .update({ title, description, completed })
    .eq('id', id)
  
  if (error) {
    return {
      success: false,
      error: error.message
    }
  }
  
  revalidatePath('/todos')
  revalidatePath(`/todos/${id}`)
  
  return {
    success: true,
    message: 'Todo updated successfully'
  }
}
```

**Security Considerations**:
- Protect server actions with authentication middleware
- Validate all form data with Zod or similar
- Use CSRF tokens for form submissions
- Implement rate limiting on server actions
- Sanitize inputs to prevent XSS

**Performance Optimizations**:
- Use React Server Components for static content
- Implement streaming for dynamic content
- Cache API responses with `revalidate` option
- Use `next/dynamic` for code splitting
- Optimize images with Next.js Image component

**Troubleshooting**:
```
Common Issues:
1. "Server Actions not working" → Check 'use server' directive and Next.js version
2. "Revalidation not happening" → Ensure revalidatePath is called after mutations
3. "Layout slots not rendering" → Check slot naming conventions in layout.tsx
4. "Route groups not working" → Verify folder naming convention (parentheses)
```

---

## 8. TYPE-SAFE API WITH TANSTACK QUERY

### Pattern 8.1: Type-Safe Data Fetching with React Query
**Use Case**: Data fetching with automatic caching, synchronization, and updates
**Complexity**: Medium
**Security Risk**: Medium (API endpoint protection)

**Implementation**:
```typescript
// lib/api-client.ts - Type-safe API client
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryOptions,
  UseMutationOptions,
} from '@tanstack/react-query'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { z } from 'zod'

// API Response Schema
const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.unknown(),
  error: z.string().optional(),
  timestamp: z.string()
})

// Paginated Response Schema
const PaginatedResponseSchema = <T extends z.ZodTypeAny>(schema: T) => 
  z.object({
    items: z.array(schema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number()
  })

// User Schema
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['admin', 'user', 'guest']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

type User = z.infer<typeof UserSchema>
type PaginatedUsers = z.infer<ReturnType<typeof PaginatedResponseSchema<UserSchema>>>

// Axios instance with interceptors
const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  }
})

// Request interceptor for auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      
      try {
        const refreshToken = localStorage.getItem('refresh_token')
        const { data } = await axios.post('/api/auth/refresh', {
          refresh_token: refreshToken
        })
        
        localStorage.setItem('access_token', data.access_token)
        apiClient.defaults.headers.common['Authorization'] = `Bearer ${data.access_token}`
        
        return apiClient(originalRequest)
      } catch (refreshError) {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
        window.location.href = '/login'
        return Promise.reject(refreshError)
      }
    }
    
    return Promise.reject(error)
  }
)

// Type-safe query function
export async function fetchUsers(
  page: number = 1,
  limit: number = 10
): Promise<PaginatedUsers> {
  const response = await apiClient.get('/users', {
    params: { page, limit }
  })
  
  const parsed = PaginatedResponseSchema(UserSchema).parse(response.data.data)
  return parsed
}

// Type-safe mutation function
export async function createUser(userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'>) {
  const response = await apiClient.post('/users', userData)
  const parsed = ApiResponseSchema.parse(response.data)
  
  if (!parsed.success) {
    throw new Error(parsed.error || 'Failed to create user')
  }
  
  return UserSchema.parse(parsed.data)
}

// React Query hooks
export function useUsers(page: number = 1, limit: number = 10) {
  return useQuery({
    queryKey: ['users', page, limit],
    queryFn: () => fetchUsers(page, limit),
    keepPreviousData: true,
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (error: Error) => {
      console.error('Failed to create user:', error)
    }
  })
}

// Optimistic updates
export function useOptimisticUpdateUser() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (updatedUser: User) => {
      const response = await apiClient.put(`/users/${updatedUser.id}`, updatedUser)
      return UserSchema.parse(response.data.data)
    },
    onMutate: async (updatedUser: User) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['users'] })
      
      // Snapshot the previous value
      const previousUsers = queryClient.getQueryData<PaginatedUsers>(['users'])
      
      // Optimistically update to the new value
      if (previousUsers) {
        queryClient.setQueryData<PaginatedUsers>(['users'], (old) => {
          if (!old) return old
          return {
            ...old,
            items: old.items.map(user => 
              user.id === updatedUser.id ? updatedUser : user
            )
          }
        })
      }
      
      return { previousUsers }
    },
    onError: (err, updatedUser, context) => {
      // Rollback to the previous value
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers)
      }
    },
    onSettled: () => {
      // Refetch after error or success
      queryClient.invalidateQueries({ queryKey: ['users'] })
    }
  })
}
```

**Query Provider Setup**:
```tsx
// app/providers.tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 3,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
            refetchOnWindowFocus: false,
            refetchOnMount: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 2,
            retryDelay: 1000,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

**Security Considerations**:
- Validate all API responses with Zod
- Implement proper error boundaries
- Use HTTPS for all API calls
- Sanitize user inputs before sending to API
- Implement rate limiting on server side
- Use CSRF protection for mutations

**Performance Optimizations**:
- Implement request deduplication
- Use stale-while-revalidate pattern
- Cache aggressively for static data
- Implement infinite scroll with pagination
- Use optimistic updates for better UX
- Prefetch data on hover or route change

**Troubleshooting**:
```
Common Issues:
1. "Query not refetching" → Check staleTime and cacheTime settings
2. "Optimistic update rolling back" → Verify mutation response matches optimistic data
3. "Type errors with Zod" → Ensure schemas match API response structure
4. "Authentication token expired" → Implement token refresh interceptor
```

---

## 9. SUPABASE AUTHENTICATION & REALTIME

### Pattern 9.1: Row Level Security with Real-time Subscriptions
**Use Case**: Secure multi-tenant data with real-time updates
**Complexity**: High
**Security Risk**: High (data leakage prevention)

**Implementation**:
```typescript
// lib/supabase.ts - Type-safe Supabase client
import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  global: {
    headers: {
      'x-application-name': 'multi-agent-platform'
    }
  }
})

// Server-side Supabase client
export const createServerClient = (cookieStore?: any) => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  )
}

// Authentication service
export class AuthService {
  static async signUp(email: string, password: string, metadata?: any) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    })
    
    if (error) throw error
    return data
  }
  
  static async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) throw error
    return data
  }
  
  static async signInWithGoogle() {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    })
    
    if (error) throw error
    return data
  }
  
  static async signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }
  
  static async getSession() {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    return data.session
  }
  
  static async getUser() {
    const { data, error } = await supabase.auth.getUser()
    if (error) throw error
    return data.user
  }
}

// Real-time subscription service
export class RealtimeService {
  private subscriptions: Map<string, any> = new Map()
  
  async subscribeToTable<T extends keyof Database['public']['Tables']>(
    table: T,
    filter: string = '',
    callback: (payload: any) => void
  ) {
    const subscription = supabase
      .channel(`public:${table}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: table as string,
          filter: filter
        },
        callback
      )
      .subscribe()
    
    this.subscriptions.set(`${table}:${filter}`, subscription)
    
    return () => {
      subscription.unsubscribe()
      this.subscriptions.delete(`${table}:${filter}`)
    }
  }
  
  async subscribeToUserChannel(
    userId: string,
    callback: (payload: any) => void
  ) {
    const subscription = supabase
      .channel(`user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe()
    
    this.subscriptions.set(`user:${userId}`, subscription)
    
    return () => {
      subscription.unsubscribe()
      this.subscriptions.delete(`user:${userId}`)
    }
  }
  
  unsubscribeAll() {
    this.subscriptions.forEach((subscription) => {
      subscription.unsubscribe()
    })
    this.subscriptions.clear()
  }
}
```

**Row Level Security Policies**:
```sql
-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile" 
ON profiles FOR SELECT 
USING (auth.uid() = user_id);

-- Policy: Users can update their own profile
CREATE POLICY "Users can update own profile" 
ON profiles FOR UPDATE 
USING (auth.uid() = user_id);

-- Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile" 
ON profiles FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Policy: Admin can view all profiles
CREATE POLICY "Admins can view all profiles" 
ON profiles FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE user_id = auth.uid() 
    AND role = 'admin'
  )
);

-- Policy: Multi-tenant data isolation
CREATE POLICY "Tenant data isolation" 
ON tenant_data FOR ALL 
USING (tenant_id IN (
  SELECT tenant_id FROM tenant_members 
  WHERE user_id = auth.uid()
));
```

**Security Considerations**:
- Always enable RLS on tables with user data
- Use service role key only on server side
- Validate JWT tokens on each request
- Implement rate limiting for authentication endpoints
- Use secure password policies
- Enable email confirmation for signups

**Performance Optimizations**:
- Use connection pooling with Supabase
- Implement efficient indexes for RLS policies
- Cache user sessions with Redis
- Batch real-time updates
- Use materialized views for complex queries

**Troubleshooting**:
```
Common Issues:
1. "RLS policy blocking access" → Check auth.uid() matches user_id
2. "Real-time not working" → Verify WebSocket connection and channel naming
3. "Session not persisting" → Check cookie settings and SameSite policies
4. "OAuth redirect issues" → Verify redirect URL in Supabase dashboard
```

---

## 10. VERCEL DEPLOYMENT WITH CI/CD

### Pattern 10.1: Zero-downtime Deployment Pipeline
**Use Case**: Automated deployments with rollback capabilities
**Complexity**: Medium
**Security Risk**: Low (with proper secrets management)

**Implementation**:
```yaml
# .github/workflows/deploy.yml
name: Deploy to Vercel

on:
  push:
    branches:
      - main
      - staging
  pull_request:
    branches:
      - main
    types: [opened, synchronize, reopened]

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      NEXTAUTH_SECRET: ${{ secrets.NEXTAUTH_SECRET }}
      NEXTAUTH_URL: ${{ secrets.NEXTAUTH_URL }}
    
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
      
      - name: Type check
        run: npm run type-check
      
      - name: Lint
        run: npm run lint
      
      - name: Run tests
        run: npm test
      
      - name: Build
        run: npm run build

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/staging'
    runs-on: ubuntu-latest
    environment: staging
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Vercel CLI
        run: npm install --global vercel@latest
      
      - name: Pull Vercel Environment Information
        run: vercel pull --yes --environment=preview --token=${{ secrets.VERCEL_TOKEN }}
      
      - name: Build Project Artifacts
        run: vercel build --token=${{ secrets.VERCEL_TOKEN }}
      
      - name: Deploy to Vercel
        run: vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }}

  deploy-production:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      
      - name: Setup Vercel CLI
        run: npm install --global vercel@latest
      
      - name: Pull Vercel Environment Information
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      
      - name: Build Project Artifacts
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
      
      - name: Deploy to Vercel
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
      
      - name: Run Production Checks
        run: |
          curl -f https://${{ secrets.PRODUCTION_URL }}/api/health || exit 1
          curl -f https://${{ secrets.PRODUCTION_URL }}/api/ready || exit 1
      
      - name: Notify Deployment
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.repos.createDeployment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              ref: context.sha,
              environment: 'production',
              description: 'Production deployment',
              required_contexts: []
            })
```

**Vercel Configuration**:
```json
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "package.json",
      "use": "@vercel/next",
      "config": {
        "distDir": ".next"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/$1",
      "headers": {
        "Cache-Control": "public, max-age=0, must-revalidate"
      }
    },
    {
      "src": "/_next/static/(.*)",
      "headers": {
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    },
    {
      "src": "/static/(.*)",
      "headers": {
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    },
    {
      "src": "/(.*)",
      "dest": "/",
      "headers": {
        "Cache-Control": "public, max-age=0, must-revalidate"
      }
    }
  ],
  "env": {
    "NEXT_PUBLIC_API_URL": "https://api.example.com",
    "NEXT_PUBLIC_SUPABASE_URL": "@supabase-url",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY": "@supabase-anon-key",
    "NEXTAUTH_URL": "@nextauth-url",
    "NEXTAUTH_SECRET": "@nextauth-secret"
  },
  "build": {
    "env": {
      "NEXT_PUBLIC_VERCEL_ENV": "production"
    }
  },
  "git": {
    "deploymentEnabled": {
      "main": true,
      "staging": true
    }
  },
  "regions": ["iad1"],
  "crons": [
    {
      "path": "/api/cron/daily",
      "schedule": "0 0 * * *"
    }
  ]
}
```

**Docker Configuration for CI/CD**:
```dockerfile
# Dockerfile
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

**Security Considerations**:
- Store secrets in Vercel Environment Variables
- Use preview deployments for PRs
- Implement branch protection rules
- Scan dependencies for vulnerabilities
- Use HTTPS redirects
- Implement CSP headers

**Performance Optimizations**:
- Enable Edge Functions for critical APIs
- Use Image Optimization with Vercel
- Implement ISR for static pages
- Use Vercel Analytics for performance monitoring
- Enable Speed Insights

**Troubleshooting**:
```
Common Issues:
1. "Build failing on Vercel" → Check Node.js version and build command
2. "Environment variables missing" → Verify Vercel project settings
3. "Deployment stuck" → Check Vercel deployment logs
4. "CORS issues" → Verify vercel.json routes configuration
```

---

## 11. MONITORING WITH SENTRY & VERCEL ANALYTICS

### Pattern 11.1: Full-stack Error Tracking & Performance Monitoring
**Use Case**: Real-time error tracking and performance monitoring
**Complexity**: Medium
**Security Risk**: Low (PII filtering)

**Implementation**:
```typescript
// lib/monitoring.ts - Unified monitoring setup
import * as Sentry from '@sentry/nextjs'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { BrowserTracing } from '@sentry/tracing'

export class MonitoringService {
  static initialize() {
    if (process.env.NODE_ENV === 'production') {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
        integrations: [
          new BrowserTracing({
            tracePropagationTargets: ['localhost', /^https:\/\/.*\.vercel\.app/],
          }),
          new Sentry.Replay(),
        ],
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
        release: process.env.NEXT_PUBLIC_VERSION || '1.0.0',
        
        beforeSend(event) {
          // Filter out sensitive data
          if (event.request) {
            delete event.request.cookies
            delete event.request.headers?.['authorization']
            delete event.request.headers?.['cookie']
          }
          
          // Filter PII from errors
          event.exception?.values?.forEach((value) => {
            value.value = value.value?.replace(/password=[^&]*/, 'password=***')
            value.value = value.value?.replace(/token=[^&]*/, 'token=***')
            value.value = value.value?.replace(/api_key=[^&]*/, 'api_key=***')
          })
          
          return event
        },
      })
    }
  }
  
  static captureError(error: Error, context?: any) {
    Sentry.captureException(error, {
      contexts: {
        app: {
          version: process.env.NEXT_PUBLIC_VERSION,
          environment: process.env.NEXT_PUBLIC_VERCEL_ENV,
        },
        ...context,
      },
    })
  }
  
  static captureMessage(message: string, level: Sentry.SeverityLevel = 'info') {
    Sentry.captureMessage(message, level)
  }
  
  static setUser(user: { id: string; email?: string; username?: string }) {
    Sentry.setUser(user)
  }
  
  static startTransaction(name: string, op: string) {
    return Sentry.startTransaction({
      name,
      op,
    })
  }
}

// Error boundary component
import React from 'react'
import * as Sentry from '@sentry/nextjs'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, {
      contexts: {
        react: {
          componentStack: errorInfo.componentStack,
        },
      },
    })
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="error-boundary">
          <h2>Something went wrong</h2>
          <button onClick={() => window.location.reload()}>
            Reload page
          </button>
          <button onClick={() => this.setState({ hasError: false })}>
            Try again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

// API route monitoring
export const withMonitoring = (handler: Function) => {
  return async (req: Request, res: Response) => {
    const transaction = Sentry.startTransaction({
      op: 'http.server',
      name: `${req.method} ${req.url}`,
    })
    
    Sentry.configureScope((scope) => {
      scope.setSpan(transaction)
    })
    
    try {
      const result = await handler(req, res)
      transaction.setStatus('ok')
      return result
    } catch (error) {
      transaction.setStatus('internal_error')
      Sentry.captureException(error)
      throw error
    } finally {
      transaction.finish()
    }
  }
}
```

**Performance Monitoring Dashboard**:
```typescript
// components/performance-dashboard.tsx
'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface PerformanceMetrics {
  timestamp: string
  fps: number
  memory: number
  loadTime: number
  firstContentfulPaint: number
  largestContentfulPaint: number
  cumulativeLayoutShift: number
}

export function PerformanceDashboard() {
  const [metrics, setMetrics] = useState<PerformanceMetrics[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const response = await fetch('/api/performance-metrics')
        const data = await response.json()
        setMetrics(data)
      } catch (error) {
        console.error('Failed to load metrics:', error)
      } finally {
        setLoading(false)
      }
    }

    loadMetrics()
    const interval = setInterval(loadMetrics, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div>Loading performance metrics...</div>
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">FPS</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? metrics[metrics.length - 1].fps.toFixed(1) : '0'} FPS
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Memory</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? (metrics[metrics.length - 1].memory / 1024 / 1024).toFixed(2) : '0'} MB
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">Load Time</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? metrics[metrics.length - 1].loadTime.toFixed(0) : '0'} ms
          </p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm font-medium text-gray-500">CLS</h3>
          <p className="text-2xl font-bold">
            {metrics.length > 0 ? metrics[metrics.length - 1].cumulativeLayoutShift.toFixed(3) : '0'}
          </p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-4">Performance Over Time</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="fps" stroke="#8884d8" name="FPS" />
              <Line type="monotone" dataKey="loadTime" stroke="#82ca9d" name="Load Time (ms)" />
              <Line type="monotone" dataKey="firstContentfulPaint" stroke="#ffc658" name="FCP (ms)" />
              <Line type="monotone" dataKey="largestContentfulPaint" stroke="#ff8042" name="LCP (ms)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
```

**Security Considerations**:
- Filter PII from error reports
- Use source maps only in development
- Implement IP anonymization
- Set up data retention policies
- Configure alert thresholds for errors

**Performance Optimizations**:
- Use performance marks for custom metrics
- Implement Real User Monitoring (RUM)
- Track Core Web Vitals
- Set up anomaly detection
- Monitor API response times

**Troubleshooting**:
```
Common Issues:
1. "Sentry not capturing errors" → Check DSN configuration and CORS settings
2. "Source maps not uploading" → Verify build configuration and upload scripts
3. "Performance metrics missing" → Check browser compatibility and sampling rate
4. "High volume of errors" → Implement error filtering and deduplication
```

---

## 12. INTERNATIONALIZATION WITH NEXT-INTL

### Pattern 12.1: Multi-language App with Dynamic Routing
**Use Case**: Support multiple languages with SEO-friendly URLs
**Complexity**: Medium
**Security Risk**: Low (XSS prevention)

**Implementation**:
```typescript
// next.config.js - i18n configuration
/** @type {import('next').NextConfig} */
const nextConfig = {
  i18n: {
    locales: ['en', 'fr', 'es', 'de', 'ja', 'ko'],
    defaultLocale: 'en',
    localeDetection: true,
  },
  // Other Next.js config...
}

module.exports = nextConfig

// middleware.ts - Locale detection and routing
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { match } from '@formatjs/intl-localematcher'
import Negotiator from 'negotiator'

const locales = ['en', 'fr', 'es', 'de', 'ja', 'ko']
const defaultLocale = 'en'

function getLocale(request: NextRequest): string {
  const negotiatorHeaders: Record<string, string> = {}
  request.headers.forEach((value, key) => (negotiatorHeaders[key] = value))

  const languages = new Negotiator({ headers: negotiatorHeaders }).languages()
  
  try {
    return match(languages, locales, defaultLocale)
  } catch {
    return defaultLocale
  }
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  
  // Check if there is any supported locale in the pathname
  const pathnameIsMissingLocale = locales.every(
    (locale) => !pathname.startsWith(`/${locale}/`) && pathname !== `/${locale}`
  )

  // Redirect if there is no locale
  if (pathnameIsMissingLocale) {
    const locale = getLocale(request)
    
    return NextResponse.redirect(
      new URL(`/${locale}${pathname.startsWith('/') ? '' : '/'}${pathname}`, request.url)
    )
  }
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}

// app/[locale]/layout.tsx - Locale-specific layout
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { routing } from '@/i18n/routing'

export async function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  
  if (!routing.locales.includes(locale as any)) {
    notFound()
  }
  
  const messages = await getMessages({ locale })
  
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}

// i18n/routing.ts - Type-safe routing
import { createSharedPathnamesNavigation } from 'next-intl/navigation'
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'fr', 'es', 'de', 'ja', 'ko'],
  defaultLocale: 'en',
  localePrefix: 'always',
})

export const { Link, redirect, usePathname, useRouter } = createSharedPathnamesNavigation(routing)

// i18n/request.ts - Server-side locale detection
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale
  }
  
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    timeZone: 'UTC',
    now: new Date(),
  }
})

// messages/en.json - English translations
{
  "common": {
    "welcome": "Welcome to Multi-Agent Platform",
    "loading": "Loading...",
    "error": "An error occurred",
    "retry": "Retry",
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "view": "View",
    "search": "Search",
    "filter": "Filter",
    "sort": "Sort",
    "refresh": "Refresh",
    "logout": "Logout",
    "login": "Login",
    "signup": "Sign Up",
    "profile": "Profile",
    "settings": "Settings",
    "help": "Help",
    "documentation": "Documentation",
    "contact": "Contact",
    "about": "About",
    "terms": "Terms",
    "privacy": "Privacy",
    "cookies": "Cookies"
  },
  "navigation": {
    "home": "Home",
    "dashboard": "Dashboard",
    "agents": "Agents",
    "skills": "Skills",
    "integrations": "Integrations",
    "documentation": "Documentation",
    "api": "API",
    "pricing": "Pricing",
    "blog": "Blog"
  },
  "auth": {
    "email": "Email",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "forgotPassword": "Forgot Password?",
    "rememberMe": "Remember Me",
    "loginWithGoogle": "Login with Google",
    "loginWithGithub": "Login with GitHub",
    "noAccount": "Don't have an account?",
    "hasAccount": "Already have an account?",
    "resetPassword": "Reset Password",
    "resetPasswordInstructions": "Enter your email address and we'll send you instructions to reset your password.",
    "resetPasswordSuccess": "Password reset instructions have been sent to your email.",
    "resetPasswordError": "Failed to send reset instructions.",
    "passwordReset": "Password Reset",
    "newPassword": "New Password",
    "confirmNewPassword": "Confirm New Password",
    "resetPasswordButton": "Reset Password",
    "passwordResetSuccess": "Password reset successfully.",
    "passwordResetError": "Failed to reset password."
  },
  "errors": {
    "required": "This field is required",
    "email": "Please enter a valid email address",
    "passwordLength": "Password must be at least 8 characters",
    "passwordMatch": "Passwords do not match",
    "invalidCredentials": "Invalid email or password",
    "networkError": "Network error. Please try again.",
    "serverError": "Server error. Please try again later.",
    "notFound": "Page not found",
    "unauthorized": "You are not authorized to view this page",
    "forbidden": "You don't have permission to access this resource",
    "rateLimit": "Too many requests. Please try again later."
  },
  "success": {
    "saved": "Saved successfully",
    "deleted": "Deleted successfully",
    "updated": "Updated successfully",
    "created": "Created successfully",
    "uploaded": "Uploaded successfully",
    "published": "Published successfully",
    "unpublished": "Unpublished successfully",
    "archived": "Archived successfully",
    "restored": "Restored successfully",
    "sent": "Sent successfully",
    "verified": "Verified successfully"
  }
}
```

**Server Component Usage**:
## **File 5: Integration Pattern Library (Continued)**

**(Resuming Pattern 12.1 - Server Component Usage)**

```tsx
// app/[locale]/page.tsx - Localized page
import { useTranslations } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'metadata' })
  
  return {
    title: t('home.title'),
    description: t('home.description'),
    keywords: t('home.keywords'),
  }
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale })
  
  return (
    <div className="container mx-auto px-4">
      <h1 className="text-4xl font-bold mb-6">
        {t('common.welcome')}
      </h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {['dashboard', 'agents', 'skills', 'integrations', 'documentation', 'api'].map((item) => (
          <Link
            key={item}
            href={`/${item}`}
            className="block p-6 bg-white rounded-lg shadow hover:shadow-lg transition-shadow"
          >
            <h2 className="text-2xl font-semibold mb-2">
              {t(`navigation.${item}`)}
            </h2>
            <p className="text-gray-600">
              {t(`home.${item}Description`)}
            </p>
          </Link>
        ))}
      </div>
      
      <div className="mt-8">
        <h2 className="text-3xl font-bold mb-4">
          {t('home.features')}
        </h2>
        <p className="text-lg text-gray-700">
          {t('home.featuresDescription')}
        </p>
      </div>
    </div>
  )
}
```

**Client Component Usage**:
```tsx
// components/LanguageSwitcher.tsx
'use client'

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from '@/i18n/routing'
import { Globe } from 'lucide-react'

const locales = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
]

export default function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const switchLocale = (newLocale: string) => {
    router.replace(pathname, { locale: newLocale })
  }

  const currentLocale = locales.find(l => l.code === locale)

  return (
    <div className="relative group">
      <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:border-gray-400 transition-colors">
        <Globe className="w-4 h-4" />
        <span>{currentLocale?.flag} {currentLocale?.code.toUpperCase()}</span>
      </button>
      
      <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
        {locales.map((loc) => (
          <button
            key={loc.code}
            onClick={() => switchLocale(loc.code)}
            className={`w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors flex items-center gap-2 ${locale === loc.code ? 'bg-blue-50 text-blue-600' : ''}`}
          >
            <span className="text-lg">{loc.flag}</span>
            <span>{loc.name}</span>
            <span className="text-sm text-gray-500 ml-auto">{loc.code.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

**Date and Number Formatting**:
```tsx
// components/FormattedDate.tsx
'use client'

import { useFormatter } from 'next-intl'

interface FormattedDateProps {
  date: Date | string
  format?: 'short' | 'medium' | 'long' | 'full'
  showTime?: boolean
  timeZone?: string
}

export default function FormattedDate({
  date,
  format = 'medium',
  showTime = false,
  timeZone
}: FormattedDateProps) {
  const formatDate = useFormatter()
  
  const dateObj = typeof date === 'string' ? new Date(date) : date
  
  let dateTimeFormat: Intl.DateTimeFormatOptions
  
  switch (format) {
    case 'short':
      dateTimeFormat = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        ...(showTime && { hour: '2-digit', minute: '2-digit' })
      }
      break
    case 'medium':
      dateTimeFormat = {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...(showTime && { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      }
      break
    case 'long':
      dateTimeFormat = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        ...(showTime && { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
      }
      break
    case 'full':
      dateTimeFormat = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'long'
      }
      break
  }
  
  return formatDate.dateTime(dateObj, dateTimeFormat)
}

// components/FormattedNumber.tsx
'use client'

import { useFormatter } from 'next-intl'

interface FormattedNumberProps {
  value: number
  format?: 'decimal' | 'currency' | 'percent'
  currency?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

export default function FormattedNumber({
  value,
  format = 'decimal',
  currency = 'USD',
  minimumFractionDigits = 0,
  maximumFractionDigits = 2
}: FormattedNumberProps) {
  const formatNumber = useFormatter()
  
  const numberFormat: Intl.NumberFormatOptions = {
    style: format,
    ...(format === 'currency' && { currency }),
    minimumFractionDigits,
    maximumFractionDigits
  }
  
  return formatNumber.number(value, numberFormat)
}
```

**Security Considerations**:
- Validate and sanitize all translation inputs
- Implement Content Security Policy for scripts
- Use `next-intl`'s built-in XSS protection
- Validate locale parameters to prevent path traversal
- Implement rate limiting on locale switching
- Cache translations appropriately to prevent DoS

**Performance Optimizations**:
- Use dynamic imports for non-critical translations
- Implement translation caching with Redis/Vercel KV
- Preload translations for critical paths
- Use `next/dynamic` for heavy translation files
- Implement locale-specific code splitting
- Use `next/headers` for efficient locale detection

**Troubleshooting**:
```
Common Issues:
1. "Translation keys missing" → Check messages JSON structure and locale files
2. "Locale not switching" → Verify middleware configuration and routing
3. "SSR hydration mismatch" → Ensure client/server locale consistency
4. "Build errors with i18n" → Check Next.js config and Intl polyfill
```

---

## SUMMARY OF INTEGRATION PATTERN LIBRARY

This Integration Pattern Library provides comprehensive implementation guides for the complete technology stack required for your multi-agent platform. Each pattern includes:

1. **Complete Code Examples** - Ready-to-use implementation code
2. **Security Considerations** - Protection against common vulnerabilities
3. **Performance Optimizations** - Best practices for speed and efficiency
4. **Troubleshooting Guides** - Solutions for common issues

**Key Integration Points Covered**:
- WalletConnect v1/v2 with mobile deep linking
- ERC-721 smart contracts with Pinata IPFS storage
- Vercel Image Blob optimization pipeline
- Farcaster + Neynar social integrations
- Coinbase onChainKit multi-chain wallet operations
- Tailwind CSS + shadcn/ui component architecture
- Next.js 15 App Router with parallel routes and server actions
- Type-safe API with TanStack Query
- Supabase authentication with Row Level Security
- Vercel deployment with CI/CD pipelines
- Monitoring with Sentry and Vercel Analytics
- Internationalization with next-intl

**Next Steps**:
Each pattern can be used independently or combined to build complex features. The patterns are designed to work together seamlessly, following consistent architectural principles and security best practices.
