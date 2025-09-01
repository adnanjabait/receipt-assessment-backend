// Import required packages
const { ApolloServer, gql } = require("apollo-server"); // Apollo GraphQL server
const LRU = require("lru-cache"); // Optional caching (not currently used)
const grpc = require("@grpc/grpc-js"); // gRPC client
const protoLoader = require("@grpc/proto-loader"); // Load proto files dynamically
const path = require('path'); // Path handling

// ==========================
// Load gRPC Proto Definitions
// ==========================
// Load patient.proto
const patientPackageDef = protoLoader.loadSync(
  path.join(__dirname, 'proto', 'patient.proto'), 
  { keepCase: true } // Preserve field casing from proto
);

// Load prescription.proto
const prescriptionPackageDef = protoLoader.loadSync(
  path.join(__dirname, 'proto', 'prescription.proto'), 
  { keepCase: true }
);

// Load search.proto
const searchPackageDef = protoLoader.loadSync(
  path.join(__dirname, 'proto', 'search.proto'), 
  { keepCase: true }
);

// Convert package definitions to gRPC objects
const patientProto = grpc.loadPackageDefinition(patientPackageDef).patient;
const prescriptionProto = grpc.loadPackageDefinition(prescriptionPackageDef).prescription;
const searchProto = grpc.loadPackageDefinition(searchPackageDef).search;

// ==========================
// gRPC Endpoint Configuration
// ==========================
// Set GRPC_ENDPOINT using environment variable if available, otherwise default to local docker service
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "grpc-service:50051";

// ==========================
// Initialize gRPC Clients
// ==========================
const patientClient = new patientProto.PatientService(
  GRPC_ENDPOINT,
  grpc.credentials.createInsecure() // Insecure credentials for local/dev usage
);

const prescriptionClient = new prescriptionProto.PrescriptionService(
  GRPC_ENDPOINT,
  grpc.credentials.createInsecure()
);

const searchClient = new searchProto.SearchService(
  GRPC_ENDPOINT,
  grpc.credentials.createInsecure()
);

// ==========================
// GraphQL Schema Definition
// ==========================
const typeDefs = gql`
  # Patient basic info
  type Patient {
    name: String
    age: Int
    gender: String
    contact: String
  }

  # Patient with additional medical details
  type PatientWithDetails {
    reference_number: String
    name: String
    age: Int
    gender: String
    contact: String
    doctor_name: String
    medicine_name: String
    description: String
    totalCount: Int
    totalPages: Int
  }

  # Prescription details
  type Prescription {
    reference_number: String
    patient_name: String
    age: Int
    gender: String
    contact: String
    doctor_name: String
    medicine_name: String
    description: String
  }

  # Search reference
  type Search {
    reference: [String]
  }

  # GraphQL Queries
  type Query {
    getPatient(name: String!): Patient
    getAllPatients(page: Int, pageSize: Int): [PatientWithDetails]
    getPrescription(ref_no: String!): Prescription
    getReference(ref_no: String!): Search
  }

  # GraphQL Mutation
  type Mutation {
    updatePatientDetails(
      reference_number: String!
      name: String
      age: Int
      gender: String
      contact: String
      doctor_name: String
      medicine_name: String
      description: String
    ): Boolean
  }
`;

// ==========================
// GraphQL Resolvers
// ==========================
const resolvers = {
  Query: {
    // Get a single patient by name
    getPatient: (_, { name }) =>
      new Promise((resolve, reject) => {
        patientClient.GetPatient({ name }, (err, response) => {
          if (err) reject(err);
          else resolve(response);
        });
      }),

    // Get all patients with pagination support
    getAllPatients: (_, { page, pageSize }) =>
      new Promise((resolve, reject) => {
        patientClient.GetAllPatients({ page, pageSize }, (err, response) => {
          if (err) reject(err);
          else resolve(response.patients || []);
        });
      }),

    // Get prescription details by reference number
    getPrescription: (_, { ref_no }) =>
      new Promise((resolve, reject) => {
        prescriptionClient.GetPrescription({ ref_no }, (err, response) => {
          if (err) reject(err);
          else resolve(response);
        });
      }),

    // Get reference numbers related to a patient
    getReference: (_, { ref_no }) =>
      new Promise((resolve, reject) => {
        searchClient.GetReference({ ref_no }, (err, response) => {
          if (err) reject(err);
          else resolve(response);
        });
      }),
  },

  Mutation: {
    // Update patient details
    updatePatientDetails: (_, args) =>
      new Promise((resolve, reject) => {
        console.log("🟡 GraphQL Mutation received:", args);
        
        // Call gRPC UpdatePatientDetails
        patientClient.UpdatePatientDetails(args, (err, response) => {
          if (err) {
            console.error("❌ gRPC Error:", err);
            reject(err);
          } else {
            console.log("✅ gRPC Response:", response);
            resolve(response.success);
          }
        });
      }),
  },
};

// ==========================
// Initialize Apollo Server
// ==========================
const server = new ApolloServer({ typeDefs, resolvers });

// Start server on port 4000
server.listen({ port: 4000 }).then(({ url }) => {
  console.log(`🚀 GraphQL BFF running at ${url}`);
});
