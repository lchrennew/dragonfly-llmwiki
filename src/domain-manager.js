import fs from 'fs';
import path from 'path';
import { WIKI_DIR } from './wiki-ops.js';

const DOMAINS_DIR = path.join(WIKI_DIR, 'domains');
const META_FILE = path.join(DOMAINS_DIR, '_meta.json');

function ensureDomainsDir() {
  if (!fs.existsSync(DOMAINS_DIR)) {
    fs.mkdirSync(DOMAINS_DIR, { recursive: true });
  }
}

function loadDomainsMeta() {
  if (!fs.existsSync(META_FILE)) {
    return { domains: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
  } catch (e) {
    return { domains: {} };
  }
}

function saveDomainsMeta(meta) {
  ensureDomainsDir();
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
}

export function listDomains() {
  const meta = loadDomainsMeta();
  return Object.keys(meta.domains);
}

export function getDomainInfo(domainName) {
  const meta = loadDomainsMeta();
  return meta.domains[domainName] || null;
}

export function createDomain(domainName, info = {}) {
  const meta = loadDomainsMeta();
  
  if (meta.domains[domainName]) {
    return { success: false, reason: 'domain_exists' };
  }

  meta.domains[domainName] = {
    created: new Date().toISOString().slice(0, 10),
    parent: info.parent || null,
    aliases: info.aliases || [],
    description: info.description || '',
    concept_count: 0,
    entity_count: 0,
    evolution: [
      {
        date: new Date().toISOString().slice(0, 10),
        action: 'created',
        reason: info.reason || '新建领域'
      }
    ]
  };

  saveDomainsMeta(meta);
  return { success: true, domain: meta.domains[domainName] };
}

export function updateDomain(domainName, updates) {
  const meta = loadDomainsMeta();
  
  if (!meta.domains[domainName]) {
    return { success: false, reason: 'domain_not_found' };
  }

  Object.assign(meta.domains[domainName], updates);
  saveDomainsMeta(meta);
  return { success: true, domain: meta.domains[domainName] };
}

export function recordDomainEvolution(domainName, action, reason) {
  const meta = loadDomainsMeta();
  
  if (!meta.domains[domainName]) {
    return { success: false, reason: 'domain_not_found' };
  }

  meta.domains[domainName].evolution.push({
    date: new Date().toISOString().slice(0, 10),
    action,
    reason
  });

  saveDomainsMeta(meta);
  return { success: true };
}

export function analyzeDomainHealth() {
  const meta = loadDomainsMeta();
  const issues = [];

  for (const [name, info] of Object.entries(meta.domains)) {
    if (info.concept_count > 20) {
      issues.push({
        type: 'oversized_domain',
        domain: name,
        count: info.concept_count,
        suggestion: `领域 "${name}" 包含 ${info.concept_count} 个概念，建议细分为子领域`
      });
    }

    if (info.concept_count === 0 && info.entity_count === 0) {
      issues.push({
        type: 'empty_domain',
        domain: name,
        suggestion: `领域 "${name}" 没有任何内容，考虑删除或填充内容`
      });
    }
  }

  return issues;
}

export function extractDomainsFromFiles(directory) {
  const domains = new Set();
  
  if (!fs.existsSync(directory)) {
    return Array.from(domains);
  }

  const files = fs.readdirSync(directory);
  
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    
    const filePath = path.join(directory, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const domainsMatch = frontmatter.match(/domains:\s*\[(.*?)\]/);
      
      if (domainsMatch) {
        const domainsList = domainsMatch[1]
          .split(',')
          .map(d => d.trim().replace(/['"]/g, ''))
          .filter(d => d);
        
        domainsList.forEach(d => domains.add(d));
      }
    }
  }

  return Array.from(domains);
}

export function updateDomainCounts() {
  const conceptsDir = path.join(WIKI_DIR, 'concepts');
  const entitiesDir = path.join(WIKI_DIR, 'entities');
  
  const conceptDomains = extractDomainsFromFiles(conceptsDir);
  const entityDomains = extractDomainsFromFiles(entitiesDir);
  
  const meta = loadDomainsMeta();
  
  for (const domainName of Object.keys(meta.domains)) {
    meta.domains[domainName].concept_count = 0;
    meta.domains[domainName].entity_count = 0;
  }
  
  const countDomains = (directory, countField) => {
    if (!fs.existsSync(directory)) return;
    
    const files = fs.readdirSync(directory);
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      
      const filePath = path.join(directory, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (frontmatterMatch) {
        const frontmatter = frontmatterMatch[1];
        const domainsMatch = frontmatter.match(/domains:\s*\[(.*?)\]/);
        
        if (domainsMatch) {
          const domainsList = domainsMatch[1]
            .split(',')
            .map(d => d.trim().replace(/['"]/g, ''))
            .filter(d => d);
          
          domainsList.forEach(d => {
            if (meta.domains[d]) {
              meta.domains[d][countField]++;
            }
          });
        }
      }
    }
  };
  
  countDomains(conceptsDir, 'concept_count');
  countDomains(entitiesDir, 'entity_count');
  
  saveDomainsMeta(meta);
  return meta.domains;
}
