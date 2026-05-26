export const roles = [
  { id: "super-admin", label: "Super Admin", path: "/admin/dashboard" },
  { id: "gm-sm", label: "GM / SM Tracking", path: "/gm/dashboard" },
  { id: "finance-desk", label: "Finance Desk", path: "/finance/dashboard" },
  { id: "bank-manager", label: "Bank Branch Manager", path: "/bank-manager/dashboard" },
  { id: "loan-executive", label: "Loan Executive", path: "/loan-executive/dashboard" },
];

export const statuses = ["New", "Under Review", "Bank Processing", "Approved", "Rejected", "Disbursed"];

export const bankPartners = [
  { name: "HDFC Bank", logo: "/assets/banks/hdfc.png" },
  { name: "ICICI Bank", logo: "/assets/banks/icici.png" },
  { name: "State Bank of India", logo: "/assets/banks/sbi.png" },
  { name: "Kotak Mahindra Bank", logo: "/assets/banks/kotak.png" },
  { name: "Axis Bank", logo: "/assets/banks/axis.png" },
  { name: "Bank of Baroda", logo: "/assets/banks/bob.png" },
];

export const featuredCars = [
  { id: 1, brand: "Tata", model: "Harrier.ev", price: 2899000, rate: 8.65, image: "/assets/cars/harrier-ev.png" },
  { id: 2, brand: "Mahindra", model: "XUV700", price: 2490000, rate: 8.85, image: "/assets/cars/xuv700.jpg" },
  { id: 3, brand: "Hyundai", model: "Creta", price: 1695000, rate: 8.75, image: "/assets/cars/creta.jpg" },
  { id: 4, brand: "Toyota", model: "Fortuner", price: 4120000, rate: 9.1, image: "/assets/cars/fortuner.jpg" },
  { id: 5, brand: "Kia", model: "Seltos", price: 1820000, rate: 8.8, image: "/assets/cars/seltos.jpg" },
  { id: 6, brand: "Maruti", model: "Brezza", price: 1340000, rate: 8.55, image: "/assets/cars/brezza.jpg" },
];

export const services = [
  { title: "New Car Loan", desc: "Fast approvals for new vehicle finance with bank-wise offers and dealer coordination." },
  { title: "Used Car Loan", desc: "Structured funding for pre-owned cars with valuation, document checks, and lender matching." },
  { title: "Refinance", desc: "Switch an existing loan to better terms with a transparent eligibility and savings workflow." },
  { title: "Top-up Loan", desc: "Unlock additional funds on existing car finance for qualified customers." },
  { title: "Commercial Vehicle Loan", desc: "Finance support for fleet, taxi, light commercial, and business vehicle purchases." },
];

export const documents = [
  "Aadhaar",
  "PAN",
  "Salary Slip",
  "Bank Statement",
  "Invoice",
  "Electricity Bill",
  "RC",
  "Insurance",
];

export const leads = [
  {
    id: "CLS-1048",
    customer: "Aarav Mehta",
    car: "Tata Harrier.ev",
    amount: "Rs. 23.2L",
    bank: "HDFC Bank",
    owner: "Priya Nair",
    status: "Bank Processing",
    documents: 6,
    updated: "Today, 11:20 AM",
  },
  {
    id: "CLS-1047",
    customer: "Nisha Kapoor",
    car: "Hyundai Creta",
    amount: "Rs. 12.4L",
    bank: "ICICI Bank",
    owner: "Rahul Verma",
    status: "Approved",
    documents: 8,
    updated: "Today, 10:05 AM",
  },
  {
    id: "CLS-1042",
    customer: "Karan Shah",
    car: "Mahindra XUV700",
    amount: "Rs. 19.8L",
    bank: "State Bank of India",
    owner: "Amit Sinha",
    status: "Under Review",
    documents: 4,
    updated: "Yesterday, 5:35 PM",
  },
  {
    id: "CLS-1038",
    customer: "Meera Iyer",
    car: "Toyota Fortuner",
    amount: "Rs. 32.7L",
    bank: "Kotak Mahindra Bank",
    owner: "Priya Nair",
    status: "Disbursed",
    documents: 8,
    updated: "22 May, 4:15 PM",
  },
];

export const timeline = [
  { title: "Lead submitted", body: "Dealership finance desk added customer and vehicle details.", time: "09:45 AM" },
  { title: "Documents verified", body: "Aadhaar, PAN, salary slip, and invoice cleared.", time: "10:30 AM" },
  { title: "Bank processing", body: "Bank partner reviewing repayment eligibility.", time: "11:20 AM" },
];

export const testimonials = [
  { name: "Rohit Malhotra", role: "Dealer Principal", quote: "CarLoanSaathi brought our sales and loan teams onto one clean operating system." },
  { name: "Sneha Rao", role: "Finance Manager", quote: "The pipeline view makes approvals, documents, and disbursements easy to track." },
  { name: "Imran Khan", role: "Bank Partner", quote: "We receive cleaner cases and close decisions with less back-and-forth." },
];
