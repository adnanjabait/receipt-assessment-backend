const { ApolloServer, gql } = require("apollo-server");
const LRU = require("lru-cache");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require('path');

// Load proto files
const patientPackageDef = protoLoader.loadSync(path.join(__dirname, 'proto', 'patient.proto'), { keepCase: true });
const prescriptionPackageDef = protoLoader.loadSync(path.join(__dirname, 'proto', 'prescription.proto'), { keepCase: true });
const searchPackageDef = protoLoader.loadSync(path.join(__dirname, 'proto', 'search.proto'), { keepCase: true });

const patientProto = grpc.loadPackageDefinition(patientPackageDef).patient;
const prescriptionProto = grpc.loadPackageDefinition(prescriptionPackageDef).prescription;
const searchProto = grpc.loadPackageDefinition(searchPackageDef).search;

// gRPC endpoint (set for aws ecs, default: local docer)
const GRPC_ENDPOINT = process.env.GRPC_ENDPOINT || "grpc-service:50051";

// gRPC clients
const patientClient = new patientProto.PatientService(
  GRPC_ENDPOINT,
  grpc.credentials.createInsecure()
);

const prescriptionClient = new prescriptionProto.PrescriptionService(
  GRPC_ENDPOINT,
  grpc.credentials.createInsecure()
);

const searchClient = new searchProto.SearchService(
  GRPC_ENDPOINT,
  grpc.credentials.createInsecure()
);

// GraphQL schema
const typeDefs = gql`
  type Patient {
    name: String
    age: Int
    gender: String
    contact: String
  }

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

  type Search {
    reference: [String]
  }

  type Query {
    getPatient(name: String!): Patient
    getAllPatients(page: Int, pageSize: Int): [PatientWithDetails]
    getPrescription(ref_no: String!): Prescription
    getReference(ref_no: String!): Search
  }
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

// Resolvers
const resolvers = {
  Query: {
    getPatient: (_, { name }) =>
      new Promise((resolve, reject) => {
        patientClient.GetPatient({ name }, (err, response) => {
          if (err) reject(err);
          else resolve(response);
        });
      }),
    getAllPatients: (_, { page, pageSize }) =>
    new Promise((resolve, reject) => {
      patientClient.GetAllPatients({ page, pageSize }, (err, response) => {
        if (err) reject(err);
        else resolve(response.patients || []);
      });
    }),

    getPrescription: (_, { ref_no }) =>
      new Promise((resolve, reject) => {
        prescriptionClient.GetPrescription({ ref_no }, (err, response) => {
          if (err) reject(err);
          else resolve(response);
        });
      }),
    getReference: (_, { ref_no }) =>
      new Promise((resolve, reject) => {
        searchClient.GetReference({ ref_no }, (err, response) => {
          if (err) reject(err);
          else resolve(response);
        });
      }),
  },
  Mutation: {
    updatePatientDetails: (_, args) =>
      new Promise((resolve, reject) => {
        console.log("🟡 GraphQL Mutation received:", args);
        
        // Create gRPC client call
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

// Apollo server
const server = new ApolloServer({ typeDefs, resolvers });

server.listen({ port: 4000 }).then(({ url }) => {
  console.log(`🚀 GraphQL BFF running at ${url}`);
});
