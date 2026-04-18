# INTER-AGENT COMMUNICATION PROTOCOLS

## OVERVIEW
This document defines how Agent 3 (Integration Explainer) communicates with:
- Agent 1 (SkillMarkdown Architect)
- Agent 2 (VSCode Generator)
- Venice.ai memory system
- External APIs and services

## COMMUNICATION ARCHITECTURE

### System Design
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Agent 3       │◄───►│   Agent 1       │◄───►│   Agent 2       │
│  (Explainer)    │     │  (Skill Arch)   │     │  (Code Gen)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                 SHARED CONTEXT & MEMORY SYSTEM                  │
│                     (Venice.ai Memory)                          │
└─────────────────────────────────────────────────────────────────┘
```

## MESSAGE FORMATS

### Standard Message Format
```json
{
  "message_id": "uuid-v4",
  "timestamp": "2026-04-12T10:30:00.000Z",
  "sender": "agent3",
  "recipients": ["agent1", "agent2"],
  "message_type": "request|response|broadcast|error",
  "priority": "high|medium|low",
  "correlation_id": "uuid-v4",
  "content": {
    "action": "specific_action_name",
    "parameters": {},
    "context": {},
    "payload": {}
  },
  "metadata": {
    "session_id": "uuid-v4",
    "user_id": "user_identifier",
    "task_id": "task_uuid",
    "step": 1,
    "total_steps": 5
  }
}
```

### Message Types

#### 1. **Request Messages** (Agent → Agent)
```json
{
  "message_id": "req_12345",
  "timestamp": "2026-04-12T10:30:00.000Z",
  "sender": "agent3",
  "recipients": ["agent1"],
  "message_type": "request",
  "priority": "medium",
  "correlation_id": "corr_67890",
  "content": {
    "action": "create_skill_template",
    "parameters": {
      "skill_type": "react_component",
      "complexity": "advanced",
      "framework": "nextjs_15"
    },
    "context": {
      "previous_skill_id": "skill_abc123",
      "user_feedback": "needs_more_examples"
    },
    "payload": {
      "component_spec": {
        "name": "UserProfile",
        "props": ["userId", "showDetails"],
        "state": ["isLoading", "error"],
        "hooks": ["useState", "useEffect", "useQuery"]
      }
    }
  }
}
```

#### 2. **Response Messages** (Agent → Agent)
```json
{
  "message_id": "resp_12346",
  "timestamp": "2026-04-12T10:31:00.000Z",
  "sender": "agent1",
  "recipients": ["agent3"],
  "message_type": "response",
  "priority": "medium",
  "correlation_id": "corr_67890",
  "content": {
    "action": "skill_template_created",
    "status": "success",
    "result": {
      "skill_id": "skill_def456",
      "file_path": "/skills/react/advanced/UserProfile.md",
      "validation_passed": true,
      "estimated_complexity": "medium"
    },
    "errors": [],
    "warnings": ["consider_adding_more_examples"]
  }
}
```

#### 3. **Broadcast Messages** (Agent → All)
```json
{
  "message_id": "bcast_12347",
  "timestamp": "2026-04-12T10:32:00.000Z",
  "sender": "agent3",
  "recipients": ["all"],
  "message_type": "broadcast",
  "priority": "low",
  "content": {
    "action": "system_update",
    "parameters": {
      "update_type": "configuration_change",
      "component": "security_policies"
    },
    "payload": {
      "new_policy": "api_key_rotation_30_days",
      "effective_date": "2026-04-15",
      "requires_action": "update_key_storage"
    }
  }
}
```

#### 4. **Error Messages** (Any → Any)
```json
{
  "message_id": "err_12348",
  "timestamp": "2026-04-12T10:33:00.000Z",
  "sender": "agent2",
  "recipients": ["agent3"],
  "message_type": "error",
  "priority": "high",
  "correlation_id": "corr_67891",
  "content": {
    "action": "code_generation_failed",
    "error_code": "COMPILE_ERROR",
    "error_message": "TypeScript compilation failed for generated Next.js app",
    "error_details": {
      "file": "src/components/UserProfile.tsx",
      "line": 45,
      "column": 12,
      "error": "Property 'userData' does not exist on type '{}'."
    },
    "stack_trace": "...",
    "suggested_fixes": [
      "Add proper TypeScript interfaces",
      "Check API response typing",
      "Review generated prop types"
    ]
  }
}
```

## COMMUNICATION CHANNELS

### 1. **Direct Channel** (Agent ↔ Agent)
- **Purpose**: One-to-one communication for specific tasks
- **Protocol**: HTTP/HTTPS with JSON payloads
- **Authentication**: API key + agent signature
- **Encryption**: TLS 1.3+
- **Timeout**: 30 seconds
- **Retry Policy**: Exponential backoff (3 attempts)

### 2. **Broadcast Channel** (Agent → All)
- **Purpose**: System-wide notifications and updates
- **Protocol**: WebSocket for real-time, HTTP for fallback
- **Authentication**: Broadcast token
- **Encryption**: TLS 1.3+
- **Delivery Guarantee**: At least once
- **Acknowledgment Required**: Yes

### 3. **Shared Memory Channel** (All Agents ↔ Memory System)
- **Purpose**: Persistent storage and retrieval of shared context
- **Protocol**: REST API to Venice.ai Memory System
- **Authentication**: Session token + agent ID
- **Encryption**: AES-256 at rest, TLS in transit
- **Data Retention**: 90 days default, configurable
- **Access Control**: Role-based per agent

### 4. **Event Channel** (System Events)
- **Purpose**: Asynchronous event processing
- **Protocol**: Message queue (Redis/Upstash)
- **Authentication**: Queue-specific credentials
- **Encryption**: TLS 1.3+
- **Delivery Guarantee**: Exactly once
- **Dead Letter Queue**: Enabled

## SHARED CONTEXT SCHEMA

### Core Context Object
```json
{
  "context_id": "ctx_12345",
  "created_at": "2026-04-12T10:00:00.000Z",
  "updated_at": "2026-04-12T10:05:00.000Z",
  "created_by": "agent3",
  "last_modified_by": "agent1",
  "version": 3,
  "status": "in_progress|completed|failed|blocked",
  
  "task": {
    "task_id": "task_abc123",
    "task_type": "integration_explanation|skill_generation|code_generation",
    "description": "Explain WalletConnect v2 integration patterns",
    "priority": "high",
    "deadline": "2026-04-12T18:00:00.000Z",
    "estimated_complexity": "medium",
    "actual_complexity": null,
    "time_estimate_minutes": 45,
    "time_spent_minutes": 20
  },
  
  "agents_involved": [
    {
      "agent_id": "agent3",
      "role": "explainer",
      "status": "active",
      "last_active": "2026-04-12T10:05:00.000Z",
      "contribution": "provided_security_patterns"
    },
    {
      "agent_id": "agent1",
      "role": "skill_architect",
      "status": "processing",
      "last_active": "2026-04-12T10:04:30.000Z",
      "contribution": "creating_skill_templates"
    }
  ],
  
  "artifacts": [
    {
      "artifact_id": "art_123",
      "type": "explanation_markdown",
      "name": "walletconnect_v2_integration.md",
      "location": "/artifacts/walletconnect/explanation.md",
      "size_bytes": 24567,
      "created_by": "agent3",
      "created_at": "2026-04-12T10:01:00.000Z",
      "checksum": "sha256:abc123...",
      "dependencies": [],
      "consumed_by": ["agent1"]
    },
    {
      "artifact_id": "art_124",
      "type": "skill_template",
      "name": "walletconnect_skill.md",
      "location": "/artifacts/walletconnect/skill_template.md",
      "size_bytes": 12345,
      "created_by": "agent1",
      "created_at": "2026-04-12T10:03:00.000Z",
      "checksum": "sha256:def456...",
      "dependencies": ["art_123"],
      "consumed_by": ["agent2"]
    }
  ],
  
  "dependencies": {
    "blocks": [],
    "blocked_by": [],
    "depends_on": ["task_xyz789"],
    "required_for": ["task_abc456"]
  },
  
  "progress": {
    "overall_percent": 45,
    "current_step": "explaining_security_patterns",
    "total_steps": 8,
    "completed_steps": 3,
    "next_step": "create_implementation_guide",
    "estimated_completion": "2026-04-12T11:30:00.000Z",
    "bottlenecks": ["waiting_on_agent1_validation"]
  },
  
  "metadata": {
    "user_id": "user_789",
    "session_id": "session_abc",
    "project_id": "project_xyz",
    "environment": "development",
    "tags": ["walletconnect", "web3", "authentication", "security"]
  },
  
  "state": {
    "current_input": {
      "problem": "WalletConnect v2 session persistence issues",
      "requirements": ["mobile_support", "multi_chain", "session_recovery"],
      "constraints": ["must_work_with_ios_android", "backward_compatible_v1"]
    },
    "current_output": {
      "solution_outline": "Implement session storage with encryption",
      "alternatives_considered": ["local_storage", "secure_cookies", "indexed_db"],
      "selected_approach": "encrypted_local_storage_with_backup"
    },
    "intermediate_results": [
      {
        "step": "research_walletconnect_docs",
        "result": "found_session_management_api",
        "timestamp": "2026-04-12T10:01:30.000Z"
      },
      {
        "step": "analyze_security_requirements",
        "result": "encryption_required_for_private_keys",
        "timestamp": "2026-04-12T10:02:15.000Z"
      }
    ]
  },
  
  "errors": [],
  "warnings": [
    {
      "code": "W001",
      "message": "WalletConnect v2 mobile deep linking may require additional configuration",
      "severity": "low",
      "timestamp": "2026-04-12T10:02:45.000Z",
      "acknowledged": false
    }
  ],
  
  "decisions": [
    {
      "decision_id": "dec_123",
      "made_by": "agent3",
      "made_at": "2026-04-12T10:03:00.000Z",
      "description": "Use encrypted localStorage for session persistence",
      "rationale": "Balances security with mobile compatibility",
      "alternatives_considered": ["sessionStorage", "cookies", "IndexedDB"],
      "impact": "medium",
      "reversible": true
    }
  ],
  
  "validation": {
    "validated_by": [],
    "validation_checks": [
      {
        "check_id": "val_123",
        "type": "security_review",
        "performed_by": null,
        "status": "pending",
        "required": true
      }
    ],
    "approvals_required": ["agent1", "agent2"],
    "approvals_received": []
  }
}
```

## AGENT-SPECIFIC PROTOCOLS

### Agent 3 → Agent 1 Communication
**Pattern**: Explanation → Skill Creation
```json
{
  "trigger": "agent3_completes_explanation",
  "action": "create_skill_from_explanation",
  "data_flow": "agent3_explanation → agent1_skill_template",
  "validation_required": true,
  "timeout": "5 minutes",
  "retry_count": 2
}
```

### Agent 3 → Agent 2 Communication
**Pattern**: Explanation → Code Generation
```json
{
  "trigger": "agent3_completes_implementation_guide",
  "action": "generate_code_from_spec",
  "data_flow": "agent3_spec → agent2_code",
  "validation_required": true,
  "timeout": "10 minutes",
  "retry_count": 3
}
```

### Agent 1 → Agent 3 Communication
**Pattern**: Skill Validation Request
```json
{
  "trigger": "agent1_creates_skill",
  "action": "validate_skill_against_integration",
  "data_flow": "agent1_skill → agent3_validation",
  "validation_required": false,
  "timeout": "2 minutes",
  "retry_count": 1
}
```

### Agent 2 → Agent 3 Communication
**Pattern**: Code Validation Request
```json
{
  "trigger": "agent2_generates_code",
  "action": "validate_code_against_security",
  "data_flow": "agent2_code → agent3_security_review",
  "validation_required": true,
  "timeout": "3 minutes",
  "retry_count": 2
}
```

## ERROR HANDLING PROTOCOL

### Error Classification
```yaml
Level 1: Critical
  - System cannot continue
  - Requires immediate human intervention
  - Example: Database connection lost, memory exhausted
  
Level 2: High
  - Functionality severely impacted
  - Automatic recovery attempted
  - Example: API rate limit exceeded, authentication failure
  
Level 3: Medium
  - Reduced functionality
  - Continue with degraded service
  - Example: Cache miss, slower response times
  
Level 4: Low
  - Minor issues, system fully functional
  - Log for later review
  - Example: Deprecated API warning, minor performance issue
```

### Error Recovery Flow
```
1. Error detected → Log with full context
2. Classify error level → Determine recovery strategy
3. Level 1 → Notify all agents, pause operations
4. Level 2 → Attempt automatic recovery (retry, fallback)
5. Level 3 → Continue with degraded mode, log for review
6. Level 4 → Continue normally, schedule maintenance
7. All levels → Update shared context with error details
8. Recovery attempt → Log result, update status
9. Post-recovery → Analysis and prevention planning
```

### Retry Strategy
```json
{
  "retry_policy": {
    "max_attempts": 3,
    "backoff_strategy": "exponential",
    "initial_delay_ms": 1000,
    "max_delay_ms": 10000,
    "jitter": true,
    "retryable_errors": [
      "NETWORK_ERROR",
      "TIMEOUT",
      "RATE_LIMIT",
      "TEMPORARY_UNAVAILABLE"
    ],
    "non_retryable_errors": [
      "AUTHENTICATION_ERROR",
      "VALIDATION_ERROR",
      "PERMISSION_DENIED",
      "INVALID_REQUEST"
    ]
  }
}
```

## PERFORMANCE MONITORING

### Metrics Collected
```yaml
Communication Metrics:
  - Message latency (p50, p95, p99)
  - Message throughput (messages/second)
  - Error rate by message type
  - Queue depth for each channel
  - Processing time per agent

System Metrics:
  - Memory usage per agent
  - CPU utilization
  - Network bandwidth
  - Disk I/O
  - Database connection pool usage

Business Metrics:
  - Tasks completed per hour
  - Average task completion time
  - Skill generation accuracy
  - Code generation success rate
  - User satisfaction score
```

### Alerting Rules
```json
{
  "alerts": [
    {
      "name": "high_message_latency",
      "condition": "p95_latency > 5000ms",
      "severity": "warning",
      "action": "scale_message_processor"
    },
    {
      "name": "high_error_rate",
      "condition": "error_rate > 5%",
      "severity": "critical",
      "action": "pause_and_investigate"
    },
    {
      "name": "memory_usage_high",
      "condition": "memory_usage > 80%",
      "severity": "warning",
      "action": "restart_agent"
    }
  ]
}
```

## SECURITY PROTOCOLS

### Authentication
```yaml
Agent Authentication:
  - Each agent has unique API key
  - Keys rotated every 7 days
  - JWT tokens with 15 minute expiry
  - Mutual TLS for agent-to-agent communication
  
Message Authentication:
  - HMAC signature on all messages
  - Timestamp validation (prevent replay attacks)
  - Nonce validation (prevent duplication)
  
Access Control:
  - Role-based access to shared memory
  - Agent-specific permissions
  - Audit logging for all operations
```

### Encryption
```yaml
In Transit:
  - TLS 1.3 for all communication
  - Perfect forward secrecy enabled
  - Certificate pinning for critical endpoints
  
At Rest:
  - AES-256 encryption for stored data
  - Key management via Venice.ai secure store
  - Encryption key rotation every 30 days
  
Sensitive Data:
  - API keys encrypted with separate key
  - User tokens never logged
  - Personal data masked in logs
```

## IMPLEMENTATION STEPS

### Phase 1: Basic Communication Setup
1. **Set up message formats** - Implement JSON schemas
2. **Create communication channels** - HTTP/WebSocket endpoints
3. **Implement authentication** - API keys + JWT
4. **Set up error handling** - Classification + recovery
5. **Create shared memory interface** - Venice.ai memory integration

### Phase 2: Agent Coordination
1. **Implement request/response patterns** - Direct communication
2. **Set up broadcast system** - System-wide notifications
3. **Create event channels** - Asynchronous processing
4. **Implement state synchronization** - Shared context updates
5. **Add monitoring and metrics** - Performance tracking

### Phase 3: Advanced Features
1. **Implement retry logic** - Exponential backoff
2. **Add circuit breakers** - Prevent cascade failures
3. **Set up load balancing** - Distribute work evenly
4. **Implement priority queues** - Handle urgent messages
5. **Add compression** - Reduce bandwidth usage

### Phase 4: Testing & Validation
1. **Unit tests** - Message format validation
2. **Integration tests** - Agent-to-agent communication
3. **Load tests** - High volume message handling
4. **Failure tests** - Network partition simulation
5. **Security tests** - Penetration testing

## DEBUGGING PROCEDURES

### When Communication Fails
```
1. Check agent status → Are all agents running?
2. Verify authentication → Are API keys valid?
3. Check network connectivity → Can agents reach each other?
4. Review message logs → Look for error patterns
5. Test individual endpoints → Use curl/Postman
6. Check shared memory → Is Venice.ai memory accessible?
7. Review error logs → Look for exceptions
8. Test with minimal message → Isolate the issue
```

### Performance Issues
```
1. Monitor message queues → Are they backing up?
2. Check agent CPU/Memory → Are resources constrained?
3. Review network metrics → Is bandwidth saturated?
4. Analyze message patterns → Any inefficient communication?
5. Check database performance → Is shared memory slow?
6. Review retry logic → Are retries causing loops?
7. Monitor error rates → Are failures increasing?
8. Check external dependencies → Are APIs slow?
```

## MAINTENANCE PROCEDURES

### Daily
- Review error logs and alerts
- Monitor system metrics
- Check agent health status
- Validate backup systems

### Weekly
- Rotate API keys and certificates
- Review security logs for anomalies
- Update agent software versions
- Test failover procedures

### Monthly
- Review performance trends
- Update communication protocols
- Security audit of all channels
- Capacity planning assessment

### Quarterly
- Full system security review
- Update encryption algorithms
- Review and update protocols
- Disaster recovery testing
