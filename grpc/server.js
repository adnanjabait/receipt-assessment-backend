const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const sql = require("mssql");
const path = require('path');

// Load proto
const prescriptionPackageDefinition = protoLoader.loadSync(path.join(__dirname, 'proto', 'prescription.proto'), {
  keepCase: true          // important! preserves field names like 'ref_no'
});
const patientPackageDefinition = protoLoader.loadSync(path.join(__dirname, 'proto', 'patient.proto'), {
  keepCase: true          // important! preserves field names like 'ref_no'
});
const searchPackageDefinition = protoLoader.loadSync(path.join(__dirname, 'proto', 'search.proto'), {
  keepCase: true          // important! preserves field names like 'ref_no'
});
const prescriptionProto = grpc.loadPackageDefinition(prescriptionPackageDefinition).prescription;
const patientProto = grpc.loadPackageDefinition(patientPackageDefinition).patient;
const searchProto = grpc.loadPackageDefinition(searchPackageDefinition).search;

const dbName = process.env.DB_NAME || "Receipt";
const dbServer = process.env.DB_SERVER || "receiptdb.cj4wwmucwyxc.eu-north-1.rds.amazonaws.com";
const dbPort = process.env.DB_PORT || 1433;
const dbUser = process.env.DB_USER || "receiptadmin";
const dbPassword = process.env.DB_PASSWORD || "receipt$$##221";

// SQL Server config
const sqlConfig = {
  database: dbName,
  server: dbServer,  // Server\Instance
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  options: {
    encrypt: false
  }
};

// gRPC functions
async function GetPrescription(call, callback) {
  const ref_no = call.request.ref_no;

  try {
    let pool = await sql.connect(sqlConfig);

    const query = `
      SELECT 
        pr.reference_number,
        p.name AS patient_name,
        p.age AS patient_age,
        p.gender,
        p.contact,
        d.name AS doctor_name,
        m.name AS medicine_name,
        m.description
      FROM prescription_reference pr
      JOIN patient p ON pr.patient_id = p.id
      JOIN doctor d ON pr.doctor_id = d.id
      JOIN medicine m ON pr.medicine_id = m.id
      WHERE pr.reference_number = @ref_no
    `;

    let result = await pool.request()
      .input("ref_no", sql.VarChar, ref_no)
      .query(query);

    if (result.recordset.length === 0) {
      console.warn("⚠️ No prescription found for ref_no:", ref_no);
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Prescription not found"
      });
    }
    const row = result.recordset[0];
    callback(null, {
      reference_number: row.reference_number,
      patient_name: row.patient_name,
      age: row.patient_age,
      gender: row.gender,
      contact: row.contact,
      doctor_name: row.doctor_name,
      medicine_name: row.medicine_name,
      description: row.description
    });

  } catch (err) {
    console.error("DB Error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error"
    });
  }
}

async function GetPatient(call, callback) {
  const patientName = call.request.name;
  console.log("Patient Name:", patientName);

  try {
    let pool = await sql.connect(sqlConfig);
    let result = await pool.request()
      .input("patientName", sql.VarChar, patientName)
      .query(`
        SELECT *
        FROM patient
        WHERE name = @patientName
      `);

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

async function GetAllPatients(call, callback) {
  const page = call.request.page || 1;
  const pageSize = call.request.pageSize || 10;
  const offset = (page - 1) * pageSize;

  try {
    let pool = await sql.connect(sqlConfig);

    // First, get the total count of patients
    let countResult = await pool.request()
      .query(`SELECT COUNT(*) AS totalCount FROM prescription_reference`);

    const totalCount = countResult.recordset[0].totalCount;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Now fetch paginated data
    let result = await pool.request()
      .input("offset", sql.Int, offset)
      .input("pageSize", sql.Int, pageSize)
      .query(`
        SELECT 
          pr.reference_number,
          p.name,
          p.age,
          p.gender,
          p.contact,
          d.name AS doctor_name,
          m.name AS medicine_name,
          m.description
        FROM prescription_reference pr
        JOIN patient p ON pr.patient_id = p.id
        JOIN doctor d ON pr.doctor_id = d.id
        JOIN medicine m ON pr.medicine_id = m.id
        ORDER BY pr.reference_number
        OFFSET @offset ROWS
        FETCH NEXT @pageSize ROWS ONLY
      `);

    const patients = result.recordset.map(row => ({
      reference_number: row.reference_number,
      name: row.name,
      age: row.age,
      gender: row.gender,
      contact: row.contact,
      doctor_name: row.doctor_name,
      medicine_name: row.medicine_name,
      description: row.description,
      totalCount: totalCount,
      totalPages: totalPages
    }));

    // Return both patients and totalPages
    callback(null, { patients, totalPages });

  } catch (err) {
    console.error("DB Error:", err);
    callback({
      code: grpc.status.INTERNAL,
      message: "Database error"
    });
  }
}

async function UpdatePatientDetails(call, callback) {

  const {
    reference_number,
    name,
    age,
    gender,
    contact,
    doctor_name,
    medicine_name,
    description
  } = call.request;

  try {
    let pool = await sql.connect(sqlConfig);
    
    // Start a transaction since we're updating multiple tables
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // First, get the IDs we need
      const patientResult = await transaction.request()
        .input("reference_number", sql.VarChar, reference_number)
        .query(`
          SELECT pr.patient_id, pr.doctor_id, pr.medicine_id
          FROM prescription_reference pr
          WHERE pr.reference_number = @reference_number
        `);
      
      if (patientResult.recordset.length === 0) {
        await transaction.rollback();
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
      } else {
        console.log("⏭️  No patient data to update");
      }

      // Update doctor table
      if (doctor_name) {
        await transaction.request()
          .input("doctor_id", sql.Int, doctor_id)
          .input("doctor_name", sql.VarChar, doctor_name)
          .query(`
            UPDATE doctor 
            SET name = @doctor_name
            WHERE id = @doctor_id
          `);
      } else {
        console.log("⏭️  No doctor data to update");
      }

      // Update medicine table
      if (medicine_name || description) {
        await transaction.request()
          .input("medicine_id", sql.Int, medicine_id)
          .input("medicine_name", sql.VarChar, medicine_name || null)
          .input("description", sql.VarChar, description || null)
          .query(`
            UPDATE medicine 
            SET name = COALESCE(@medicine_name, name),
                description = COALESCE(@description, description)
            WHERE id = @medicine_id
          `);
      } else {
        console.log("⏭️  No medicine data to update");
      }

      await transaction.commit();
      callback(null, { success: true });

    } catch (err) {
      console.error("❌ Error during transaction:", err);
      await transaction.rollback();
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

async function GetReference(call, callback) {
  const ref_no = call.request.ref_no;
  console.log("Reference:", ref_no);

  try {
    let pool = await sql.connect(sqlConfig);
    let result = await pool.request()
      .input("ref_no", sql.VarChar, `%${ref_no}%`)
      .query(`
        SELECT reference_number
        FROM prescription_reference
        WHERE reference_number LIKE @ref_no
      `);

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

// Start gRPC server
function main() {
  const server = new grpc.Server();
  
  server.addService(prescriptionProto.PrescriptionService.service, {
    GetPrescription: GetPrescription
  });
  server.addService(patientProto.PatientService.service, {
    GetPatient: GetPatient,
    GetAllPatients: GetAllPatients,
    UpdatePatientDetails: UpdatePatientDetails 
  });
  server.addService(searchProto.SearchService.service, {
    GetReference: GetReference
  });

  server.bindAsync("grpc-service:50051", grpc.ServerCredentials.createInsecure(), () => {
    console.log("gRPC Server running at http://grpc-service:50051");
  });
}

main();
