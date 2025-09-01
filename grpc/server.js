// ==========================
// Import Required Packages
// ==========================
const grpc = require("@grpc/grpc-js");          // gRPC library for Node.js
const protoLoader = require("@grpc/proto-loader"); // Load .proto files dynamically
const sql = require("mssql");                  // SQL Server client

// ==========================
// Load gRPC Proto Definitions
// ==========================
// Keep case ensures the field names in proto files are preserved (e.g., ref_no)
const prescriptionPackageDefinition = protoLoader.loadSync("./prescription.proto", { keepCase: true });
const patientPackageDefinition = protoLoader.loadSync("./patient.proto", { keepCase: true });
const searchPackageDefinition = protoLoader.loadSync("./search.proto", { keepCase: true });

// Load package definitions into gRPC objects
const prescriptionProto = grpc.loadPackageDefinition(prescriptionPackageDefinition).prescription;
const patientProto = grpc.loadPackageDefinition(patientPackageDefinition).patient;
const searchProto = grpc.loadPackageDefinition(searchPackageDefinition).search;

// ==========================
// Database Configuration
// ==========================
const dbName = process.env.DB_NAME || "Receipt";
const dbServer = process.env.DB_SERVER || "receiptdb.cj4wwmucwyxc.eu-north-1.rds.amazonaws.com";
const dbPort = Number(process.env.DB_PORT) || 1433;
const dbUser = process.env.DB_USER || "receiptadmin";
const dbPassword = process.env.DB_PASSWORD || "receipt$$##221";

const sqlConfig = {
  database: dbName,
  server: dbServer,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  options: {
    encrypt: false // Disable encryption (set to true if using SSL)
  }
};

// ==========================
// gRPC Service Implementations
// ==========================

// --------------------------
// GetPrescription
// Returns prescription details by reference number
// --------------------------
async function GetPrescription(call, callback) {
  const ref_no = call.request.ref_no;

  try {
    let pool = await sql.connect(sqlConfig); // Connect to DB

    const query = `
      SELECT 
        pr.reference_number,
        p.name AS patient_name,
        p.age AS patient_age,
        p.gender,
        p.contact,
        d.name AS doctor_name,
        m.name AS medicine_name
      FROM prescription_reference pr
      JOIN patient p ON pr.patient_id = p.id
      JOIN doctor d ON pr.doctor_id = d.id
      JOIN medicine m ON pr.medicine_id = m.id
      WHERE pr.reference_number = @ref_no
    `;

    let result = await pool.request()
      .input("ref_no", sql.VarChar, ref_no)
      .query(query);

    // Check if prescription exists
    if (result.recordset.length === 0) {
      console.warn("⚠️ No prescription found for ref_no:", ref_no);
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Prescription not found"
      });
    }

    const row = result.recordset[0];

    // Return prescription data
    callback(null, {
      reference_number: row.reference_number,
      patient_name: row.patient_name,
      age: row.patient_age,
      gender: row.gender,
      contact: row.contact,
      doctor_name: row.doctor_name,
      medicine_name: row.medicine_name      
    });

  } catch (err) {
    console.error("🔴 DB Error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error"
    });
  }
}

// --------------------------
// GetPatient
// Returns patient details by name
// --------------------------
async function GetPatient(call, callback) {
  const patientName = call.request.name;

  try {
    let pool = await sql.connect(sqlConfig);

    let result = await pool.request()
      .input("patientName", sql.VarChar, patientName)
      .query(`SELECT * FROM patient WHERE name = @patientName`);

    if (result.recordset.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Patient not found"
      });
    }

    const row = result.recordset[0];

    callback(null, {
      name: row.name,
      age: row.age,
      gender: row.gender,
      contact: row.contact
    });

  } catch (err) {
    console.error("DB Error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error"
    });
  }
}

// --------------------------
// GetAllPatients
// Returns paginated list of patients using stored procedure
// --------------------------
async function GetAllPatients(call, callback) {
  const page = call.request.page || 1;
  const pageSize = call.request.pageSize || 10;

  console.log("📌 [DEBUG] Incoming request:", { page, pageSize });

  try {
    let pool = await sql.connect(sqlConfig);
    console.log("✅ [DEBUG] Database connection established");

    // Execute stored procedure for pagination
    let result = await pool.request()
      .input("Page", sql.Int, page)
      .input("PageSize", sql.Int, pageSize)
      .execute("GetPatientsPaged");

    console.log("✅ [DEBUG] Stored procedure executed");

    const patients = result.recordset.map(row => ({
      reference_number: row.reference_number,
      name: row.name,
      age: row.age,
      gender: row.gender,
      contact: row.contact,
      doctor_name: row.doctor_name,
      medicine_name: row.medicine_name,
      totalCount: row.totalCount,
      totalPages: row.totalPages
    }));

    console.log("✅ [DEBUG] Patients fetched:", patients.length);

    callback(null, { patients });

  } catch (err) {
    console.error("❌ [DEBUG] DB Error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error: " + err.message
    });
  }
}

// --------------------------
// UpdatePatientDetails
// Updates patient, doctor, and medicine tables using transaction
// --------------------------
async function UpdatePatientDetails(call, callback) {
  const { reference_number, name, age, gender, contact, doctor_name, medicine_name } = call.request;

  try {
    console.log("🔌 Connecting to database...");
    let pool = await sql.connect(sqlConfig);
    console.log("✅ Database connected successfully");
    
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    console.log("🟢 Transaction started");

    try {
      // Get patient, doctor, and medicine IDs
      const patientResult = await transaction.request()
        .input("reference_number", sql.VarChar, reference_number)
        .query(`
          SELECT pr.patient_id, pr.doctor_id, pr.medicine_id
          FROM prescription_reference pr
          WHERE pr.reference_number = @reference_number
        `);

      if (patientResult.recordset.length === 0) {
        console.log("❌ No patient found with reference_number:", reference_number);
        await transaction.rollback();
        console.log("🔴 Transaction rolled back");
        return callback({
          code: grpc.status.NOT_FOUND,
          message: "Patient not found"
        });
      }

      const { patient_id, doctor_id, medicine_id } = patientResult.recordset[0];

      // Update patient table
      if (name || age || gender || contact) {
        await transaction.request()
          .input("patient_id", sql.Int, patient_id)
          .input("name", sql.VarChar, name || null)
          .input("age", sql.Int, age || null)
          .input("gender", sql.VarChar, gender || null)
          .input("contact", sql.VarChar, contact || null)
          .query(`
            UPDATE patient 
            SET name = COALESCE(@name, name),
                age = COALESCE(@age, age),
                gender = COALESCE(@gender, gender),
                contact = COALESCE(@contact, contact)
            WHERE id = @patient_id
          `);
      }

      // Update doctor table
      if (doctor_name) {
        await transaction.request()
          .input("doctor_id", sql.Int, doctor_id)
          .input("doctor_name", sql.VarChar, doctor_name)
          .query(`UPDATE doctor SET name = @doctor_name WHERE id = @doctor_id`);
      }

      // Update medicine table
      if (medicine_name) {
        await transaction.request()
          .input("medicine_id", sql.Int, medicine_id)
          .input("medicine_name", sql.VarChar, medicine_name || null)
          .query(`UPDATE medicine SET name = COALESCE(@medicine_name, name) WHERE id = @medicine_id`);
      }

      await transaction.commit();
      console.log("🟢 Transaction committed successfully");
      callback(null, { success: true });

    } catch (err) {
      console.error("❌ Error during transaction:", err);
      await transaction.rollback();
      console.log("🔴 Transaction rolled back due to error");
      throw err;
    }

  } catch (err) {
    console.error("❌ Database connection error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error: " + err.message
    });
  }
}

// --------------------------
// GetReference
// Returns all prescription references matching a pattern
// --------------------------
async function GetReference(call, callback) {
  const ref_no = call.request.ref_no;

  try {
    let pool = await sql.connect(sqlConfig);
    let result = await pool.request()
      .input("ref_no", sql.VarChar, `%${ref_no}%`)
      .query(`SELECT reference_number FROM prescription_reference WHERE reference_number LIKE @ref_no`);

    if (result.recordset.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "No reference found"
      });
    }

    const references = result.recordset.map(row => row.reference_number);
    callback(null, { reference: references });

  } catch (err) {
    console.error("DB Error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error"
    });
  }
}

// ==========================
// Start gRPC Server
// ==========================
function main() {
  const server = new grpc.Server();

  // Add services to server
  server.addService(prescriptionProto.PrescriptionService.service, { GetPrescription });
  server.addService(patientProto.PatientService.service, { GetPatient, GetAllPatients, UpdatePatientDetails });
  server.addService(searchProto.SearchService.service, { GetReference });

  // Bind and start server
  server.bindAsync("localhost:50051", grpc.ServerCredentials.createInsecure(), () => {
    console.log("🚀 gRPC Server running at http://localhost:50051");
  });
}

main();
