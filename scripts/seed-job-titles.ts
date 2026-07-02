/**
 * Comprehensive Job Titles Seed Script
 * Sources: ESCO API (free, no key needed) + curated tech + non-tech titles
 * Run: npx ts-node scripts/seed-job-titles.ts
 */

import prisma from '../src/app/utils/prisma';

const ESCO_BASE = 'https://ec.europa.eu/esco/api';
const BATCH_SIZE = 100;

// ── CURATED TECH TITLES ─────────────────────────────────────────────────────
const TECH_TITLES = [
  // Software Development
  'Software Engineer', 'Software Developer', 'Senior Software Engineer',
  'Junior Software Engineer', 'Staff Software Engineer', 'Principal Software Engineer',
  'Frontend Developer', 'Frontend Engineer', 'Backend Developer', 'Backend Engineer',
  'Full Stack Developer', 'Full Stack Engineer', 'Web Developer', 'Web Designer',
  'Mobile Developer', 'iOS Developer', 'Android Developer', 'React Native Developer',
  'Flutter Developer', 'Kotlin Developer', 'Swift Developer', 'Java Developer',
  'Python Developer', 'JavaScript Developer', 'TypeScript Developer', 'PHP Developer',
  'Ruby Developer', 'Go Developer', 'Rust Developer', 'C++ Developer', 'C# Developer',
  '.NET Developer', 'Node.js Developer', 'React Developer', 'Vue.js Developer',
  'Angular Developer', 'Next.js Developer', 'Django Developer', 'Laravel Developer',
  'Spring Boot Developer', 'Salesforce Developer', 'WordPress Developer',
  'Shopify Developer', 'Magento Developer',

  // Engineering Roles
  'Software Architect', 'Solutions Architect', 'Cloud Architect', 'Enterprise Architect',
  'Technical Architect', 'Systems Architect', 'Infrastructure Architect',
  'DevOps Engineer', 'Site Reliability Engineer', 'Platform Engineer',
  'Cloud Engineer', 'AWS Engineer', 'Azure Engineer', 'GCP Engineer',
  'Infrastructure Engineer', 'Network Engineer', 'Systems Engineer',
  'Embedded Systems Engineer', 'Firmware Engineer', 'Hardware Engineer',
  'Electrical Engineer', 'Mechanical Engineer', 'Robotics Engineer',
  'Automation Engineer', 'Test Automation Engineer', 'QA Engineer',
  'Quality Assurance Engineer', 'Performance Engineer', 'Security Engineer',
  'Cybersecurity Engineer', 'Application Security Engineer',
  'Machine Learning Engineer', 'ML Engineer', 'AI Engineer',
  'Deep Learning Engineer', 'NLP Engineer', 'Computer Vision Engineer',
  'Data Engineer', 'Data Platform Engineer', 'Analytics Engineer',
  'Database Engineer', 'Database Administrator', 'Database Developer',
  'Blockchain Developer', 'Blockchain Engineer', 'Smart Contract Developer',
  'Game Developer', 'Unity Developer', 'Unreal Engine Developer',
  'AR/VR Developer', 'Embedded Software Engineer',

  // Data & AI
  'Data Scientist', 'Senior Data Scientist', 'Lead Data Scientist',
  'Data Analyst', 'Senior Data Analyst', 'Business Intelligence Analyst',
  'BI Developer', 'BI Engineer', 'Data Architect', 'Big Data Engineer',
  'ETL Developer', 'Data Warehouse Developer', 'Hadoop Developer',
  'Spark Developer', 'MLOps Engineer', 'AI Research Scientist',
  'Research Scientist', 'Applied Scientist', 'Quantitative Analyst',
  'Statistician', 'Business Analyst', 'Systems Analyst',

  // Design
  'UI Designer', 'UX Designer', 'UI/UX Designer', 'Product Designer',
  'Graphic Designer', 'Visual Designer', 'Interaction Designer',
  'UX Researcher', 'UX Writer', 'Motion Designer', 'Web Designer',
  'Brand Designer', 'Creative Designer', 'Design Lead', 'Design Manager',
  'Head of Design', 'Chief Design Officer', '3D Artist', 'Illustrator',
  'Animator', '3D Animator', 'Video Editor', 'Motion Graphics Designer',
  'Art Director', 'Creative Director', 'Content Designer',

  // Product & Management
  'Product Manager', 'Senior Product Manager', 'Principal Product Manager',
  'Group Product Manager', 'Director of Product', 'VP of Product',
  'Chief Product Officer', 'Product Owner', 'Technical Product Manager',
  'Project Manager', 'Senior Project Manager', 'Technical Project Manager',
  'Program Manager', 'Engineering Manager', 'Tech Lead', 'Team Lead',
  'Engineering Director', 'Director of Engineering', 'VP of Engineering',
  'CTO', 'Chief Technology Officer', 'Chief Information Officer', 'CIO',
  'Chief Digital Officer', 'CDO', 'Head of Engineering', 'Head of Technology',
  'Scrum Master', 'Agile Coach', 'Release Manager', 'Delivery Manager',

  // DevOps & Cloud
  'DevOps Lead', 'Lead DevOps Engineer', 'Kubernetes Engineer',
  'Docker Engineer', 'Cloud Operations Engineer', 'CloudOps Engineer',
  'NoOps Engineer', 'Build Engineer', 'Release Engineer', 'CI/CD Engineer',
  'Configuration Manager', 'IT Operations Engineer', 'Linux Administrator',
  'Windows Administrator', 'System Administrator', 'Network Administrator',

  // Security
  'Cybersecurity Analyst', 'Information Security Analyst',
  'Penetration Tester', 'Ethical Hacker', 'Security Architect',
  'Chief Information Security Officer', 'CISO', 'SOC Analyst',
  'Threat Intelligence Analyst', 'Incident Response Analyst',
  'Security Operations Engineer', 'Identity and Access Management Engineer',
  'IAM Engineer', 'Cloud Security Engineer', 'Compliance Engineer',

  // QA & Testing
  'QA Analyst', 'Quality Assurance Analyst', 'Manual Tester',
  'Automation Tester', 'Software Test Engineer', 'QA Lead',
  'QA Manager', 'Testing Engineer', 'Performance Tester', 'Load Tester',

  // Support & IT
  'IT Support Specialist', 'Help Desk Technician', 'IT Technician',
  'Technical Support Engineer', 'Customer Support Engineer',
  'IT Manager', 'IT Director', 'IT Consultant', 'IT Analyst',
  'Desktop Support Engineer', 'Field Service Engineer',

  // Emerging
  'Prompt Engineer', 'AI Product Manager', 'AI Consultant',
  'Web3 Developer', 'DeFi Developer', 'NFT Developer',
  'IoT Engineer', 'Edge Computing Engineer', 'Quantum Computing Researcher',
];

// ── CURATED NON-TECH TITLES ─────────────────────────────────────────────────
const NON_TECH_TITLES = [
  // Business & Management
  'CEO', 'Chief Executive Officer', 'COO', 'Chief Operating Officer',
  'CFO', 'Chief Financial Officer', 'CMO', 'Chief Marketing Officer',
  'Managing Director', 'General Manager', 'Operations Manager',
  'Business Development Manager', 'Strategy Manager', 'Business Manager',
  'Entrepreneur', 'Founder', 'Co-Founder', 'Vice President',
  'Director', 'Associate Director', 'Senior Manager', 'Manager',
  'Team Manager', 'Department Head', 'Division Head',

  // Finance & Accounting
  'Accountant', 'Senior Accountant', 'Financial Analyst', 'Finance Manager',
  'Finance Director', 'Financial Controller', 'Auditor', 'Tax Consultant',
  'Investment Analyst', 'Portfolio Manager', 'Risk Analyst', 'Risk Manager',
  'Credit Analyst', 'Treasury Analyst', 'Budget Analyst', 'Cost Analyst',
  'Chartered Accountant', 'CPA', 'Bookkeeper', 'Payroll Specialist',
  'Financial Advisor', 'Wealth Manager', 'Actuary', 'Insurance Analyst',
  'Compliance Officer', 'Financial Planner', 'Investment Banker',
  'Private Equity Analyst', 'Venture Capital Analyst',

  // Marketing & Sales
  'Marketing Manager', 'Digital Marketing Manager', 'Marketing Director',
  'Head of Marketing', 'Brand Manager', 'Product Marketing Manager',
  'Content Marketing Manager', 'Social Media Manager', 'SEO Specialist',
  'SEM Specialist', 'PPC Specialist', 'Email Marketing Specialist',
  'Growth Manager', 'Growth Hacker', 'Performance Marketer',
  'Marketing Analyst', 'Market Research Analyst', 'Marketing Coordinator',
  'Campaign Manager', 'Community Manager', 'Influencer Marketing Manager',
  'Sales Manager', 'Sales Director', 'Account Executive', 'Account Manager',
  'Sales Representative', 'Business Development Representative',
  'Inside Sales Representative', 'Outside Sales Representative',
  'Sales Engineer', 'Pre-Sales Engineer', 'Customer Success Manager',
  'Customer Success Specialist', 'Key Account Manager', 'Channel Manager',
  'Partner Manager', 'Revenue Operations Manager', 'Sales Operations Manager',

  // Human Resources
  'HR Manager', 'Human Resources Manager', 'HR Director',
  'Head of Human Resources', 'HR Business Partner', 'HR Generalist',
  'Recruiter', 'Senior Recruiter', 'Technical Recruiter', 'Talent Acquisition Manager',
  'Talent Acquisition Specialist', 'Talent Manager', 'HR Coordinator',
  'Compensation and Benefits Manager', 'Learning and Development Manager',
  'L&D Specialist', 'Organizational Development Manager',
  'People Operations Manager', 'Payroll Manager', 'HR Analyst',
  'Employee Relations Manager', 'Diversity and Inclusion Manager',

  // Legal
  'Lawyer', 'Attorney', 'Legal Counsel', 'General Counsel',
  'Associate Attorney', 'Senior Associate', 'Partner', 'Paralegal',
  'Legal Assistant', 'Contract Manager', 'Compliance Manager',
  'Regulatory Affairs Manager', 'Legal Advisor', 'Corporate Lawyer',
  'Litigation Lawyer', 'Immigration Lawyer', 'Tax Lawyer',
  'Intellectual Property Lawyer', 'Employment Lawyer',

  // Healthcare
  'Doctor', 'Physician', 'General Practitioner', 'Surgeon',
  'Specialist', 'Dentist', 'Pharmacist', 'Nurse', 'Registered Nurse',
  'Nurse Practitioner', 'Midwife', 'Physiotherapist', 'Occupational Therapist',
  'Speech Therapist', 'Psychologist', 'Psychiatrist', 'Radiologist',
  'Cardiologist', 'Neurologist', 'Oncologist', 'Pediatrician',
  'Dermatologist', 'Ophthalmologist', 'Orthopedic Surgeon',
  'Medical Director', 'Clinical Director', 'Healthcare Manager',
  'Hospital Administrator', 'Health Informatics Specialist',
  'Medical Researcher', 'Biomedical Engineer', 'Lab Technician',
  'Medical Assistant', 'Healthcare Consultant',

  // Education
  'Teacher', 'Professor', 'Lecturer', 'Instructor', 'Tutor',
  'Principal', 'School Administrator', 'Education Director',
  'Curriculum Developer', 'Instructional Designer', 'E-Learning Developer',
  'Academic Advisor', 'School Counselor', 'Special Education Teacher',
  'Early Childhood Educator', 'Training Specialist', 'Corporate Trainer',

  // Engineering (non-tech)
  'Civil Engineer', 'Structural Engineer', 'Construction Engineer',
  'Project Engineer', 'Site Engineer', 'Environmental Engineer',
  'Chemical Engineer', 'Aerospace Engineer', 'Automotive Engineer',
  'Manufacturing Engineer', 'Industrial Engineer', 'Process Engineer',
  'Quality Engineer', 'Safety Engineer', 'Materials Engineer',
  'Petroleum Engineer', 'Mining Engineer', 'Nuclear Engineer',
  'Geotechnical Engineer', 'Hydraulic Engineer',

  // Operations & Supply Chain
  'Operations Director', 'Supply Chain Manager', 'Logistics Manager',
  'Procurement Manager', 'Purchasing Manager', 'Inventory Manager',
  'Warehouse Manager', 'Distribution Manager', 'Fulfillment Manager',
  'Fleet Manager', 'Transport Manager', 'Import/Export Manager',
  'Supply Chain Analyst', 'Demand Planner', 'Production Manager',
  'Manufacturing Manager', 'Plant Manager', 'Facilities Manager',

  // Customer Service
  'Customer Service Manager', 'Customer Service Representative',
  'Customer Experience Manager', 'Client Relations Manager',
  'Contact Center Manager', 'Call Center Manager', 'Support Manager',
  'Help Desk Manager', 'Service Desk Analyst',

  // Creative & Media
  'Journalist', 'Reporter', 'Editor', 'Content Writer', 'Copywriter',
  'Technical Writer', 'Content Strategist', 'Content Creator',
  'Social Media Influencer', 'Blogger', 'Podcaster', 'YouTuber',
  'Photographer', 'Videographer', 'Film Director', 'Producer',
  'Music Producer', 'Sound Engineer', 'Broadcast Engineer',
  'Public Relations Manager', 'PR Specialist', 'Communications Manager',
  'Corporate Communications Manager', 'Speechwriter',

  // Real Estate & Construction
  'Real Estate Agent', 'Real Estate Manager', 'Property Manager',
  'Real Estate Developer', 'Construction Manager', 'Architect',
  'Interior Designer', 'Urban Planner', 'Quantity Surveyor',
  'Building Inspector', 'Land Surveyor',

  // Consulting
  'Management Consultant', 'Strategy Consultant', 'Business Consultant',
  'IT Consultant', 'HR Consultant', 'Financial Consultant',
  'Marketing Consultant', 'Operations Consultant', 'ERP Consultant',
  'SAP Consultant', 'Oracle Consultant', 'Salesforce Consultant',

  // Other Professionals
  'Economist', 'Research Analyst', 'Policy Analyst', 'Political Scientist',
  'Sociologist', 'Anthropologist', 'Geographer', 'Environmental Scientist',
  'Marine Biologist', 'Biologist', 'Chemist', 'Physicist',
  'Mathematician', 'Astronomer', 'Geologist', 'Meteorologist',
  'Social Worker', 'Counselor', 'Life Coach', 'Career Coach',
  'Event Manager', 'Event Coordinator', 'Wedding Planner',
  'Travel Agent', 'Tour Guide', 'Hospitality Manager', 'Hotel Manager',
  'Restaurant Manager', 'Chef', 'Executive Chef', 'Sous Chef',
  'Nutritionist', 'Dietitian', 'Personal Trainer', 'Sports Coach',
  'Athletic Director', 'Sports Manager',
];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchEsco(offset: number): Promise<any> {
  const url = `${ESCO_BASE}/search?type=occupation&language=en&limit=${BATCH_SIZE}&offset=${offset}&full=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESCO error: ${res.status}`);
  return res.json();
}

function capitalize(s: string): string {
  return s.trim().replace(/\b\w/g, c => c.toUpperCase());
}

function addTitle(title: string, set: Set<string>) {
  const cleaned = title.trim();
  if (cleaned.length >= 2 && cleaned.length <= 100 && /[a-zA-Z]/.test(cleaned)) {
    set.add(capitalize(cleaned));
  }
}

async function main() {
  console.log('🚀 Starting comprehensive job titles seed...\n');

  const allTitles = new Set<string>();

  // 1. Add curated tech titles
  TECH_TITLES.forEach(t => addTitle(t, allTitles));
  console.log(`💻 Tech titles added: ${allTitles.size}`);

  // 2. Add curated non-tech titles
  const beforeNonTech = allTitles.size;
  NON_TECH_TITLES.forEach(t => addTitle(t, allTitles));
  console.log(`🏢 Non-tech titles added: ${allTitles.size - beforeNonTech}`);

  // 3. Fetch ESCO titles
  console.log('\n📡 Fetching from ESCO API (free, no key needed)...');
  const beforeEsco = allTitles.size;

  try {
    const first = await fetchEsco(0);
    const total = first.total as number;
    const totalBatches = Math.ceil(total / BATCH_SIZE);

    for (let batch = 0; batch < totalBatches; batch++) {
      const offset = batch * BATCH_SIZE;
      try {
        const data = batch === 0 ? first : await fetchEsco(offset);
        const results = data._embedded?.results || [];
        for (const item of results) {
          const en = item.preferredLabel?.en || item.title;
          if (en) addTitle(en, allTitles);
          const enUs = item.preferredLabel?.['en-us'];
          if (enUs) addTitle(enUs, allTitles);
          const altEn: string[] = item.alternativeLabel?.en || [];
          for (const alt of altEn) addTitle(alt, allTitles);
        }
      } catch {
        await sleep(1000);
      }
      if (batch % 5 === 0 && batch > 0) await sleep(200);
    }
  } catch (err) {
    console.log('⚠️  ESCO fetch failed, continuing with curated titles only');
  }

  console.log(`🌍 ESCO titles added: ${allTitles.size - beforeEsco}`);
  console.log(`\n✅ Total unique titles: ${allTitles.size}\n`);

  // 4. Clear and insert
  await prisma.jobTitle.deleteMany({});
  const titlesArray = Array.from(allTitles).sort();
  const chunkSize = 500;
  let inserted = 0;

  for (let i = 0; i < titlesArray.length; i += chunkSize) {
    const chunk = titlesArray.slice(i, i + chunkSize);
    await prisma.jobTitle.createMany({
      data: chunk.map(title => ({ title })),
      skipDuplicates: true,
    });
    inserted += chunk.length;
    console.log(`💾 Inserted ${Math.min(inserted, titlesArray.length)}/${titlesArray.length}`);
  }

  const finalCount = await prisma.jobTitle.count();
  console.log(`\n🎉 Done! ${finalCount} job titles ready in database.`);
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
