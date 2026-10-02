//! Nissan CONSULT protocol implementation for live ECU data.
//!
//! Protocol spec (from Nissan CONSULT documentation):
//! - 9600 baud, 8N1 serial
//! - Init: send FF FF EF, ECU responds 10
//! - Commands: 5A=read register, D1=self diag, C1=clear codes, D0=ECU info, F0=term, 03=stop stream
//! - ECU acknowledges commands by sending back the bitwise NOT of the command byte
//! - Data frames: FF (start), byte count, data bytes

use std::time::Duration;

// CONSULT command bytes
const CMD_READ_REGISTER: u8 = 0x5A;
const CMD_SELF_DIAG: u8 = 0xD1;
const CMD_CLEAR_CODES: u8 = 0xC1;
const CMD_ECU_INFO: u8 = 0xD0;
const CMD_TERM: u8 = 0xF0;
const CMD_STOP_STREAM: u8 = 0x03;
const REGISTER_NULL: u8 = 0xFF;

// Register addresses
pub const REG_TACH_MSB: u8 = 0x00;
pub const REG_TACH_LSB: u8 = 0x01;
pub const REG_MAF_L_MSB: u8 = 0x04;
pub const REG_MAF_L_LSB: u8 = 0x05;
pub const REG_MAF_R_MSB: u8 = 0x06;
pub const REG_MAF_R_LSB: u8 = 0x07;
pub const REG_COOLANT_TEMP: u8 = 0x08;
pub const REG_LEFT_O2: u8 = 0x09;
pub const REG_RIGHT_O2: u8 = 0x0A;
pub const REG_VEHICLE_SPEED: u8 = 0x0B;
pub const REG_BATTERY_VOLTAGE: u8 = 0x0C;
pub const REG_IGNITION_TIMING: u8 = 0x16;
pub const REG_TPS: u8 = 0x0D;
pub const REG_IDLE_SWITCH: u8 = 0x10;

/// Live sensor data from the ECU
#[derive(serde::Serialize, Debug, Clone, Default)]
pub struct ConsultSensors {
    pub rpm: u16,
    pub coolant_temp_c: i16,
    pub vehicle_speed_kph: u8,
    pub battery_voltage: f32,
    pub ignition_timing: i8,
    pub tps_percent: u8,
    pub maf_voltage: f32,
    pub left_o2_voltage: f32,
    pub right_o2_voltage: f32,
}

/// CONSULT protocol handler
pub struct Consult {
    port: Box<dyn serialport::SerialPort>,
}

impl Consult {
    /// Open serial port and initialize CONSULT
    pub fn new(port_name: &str) -> Result<Self, String> {
        let port = serialport::new(port_name, 9600)
            .timeout(Duration::from_millis(2000))
            .open()
            .map_err(|e| format!("Failed to open {}: {}", port_name, e))?;

        let mut c = Consult { port };
        c.init_ecu()?;
        Ok(c)
    }

    fn write_byte(&mut self, b: u8) -> Result<(), String> {
        self.port.write_all(&[b])
            .map_err(|e| format!("Write failed: {}", e))
    }

    fn read_byte(&mut self) -> Result<u8, String> {
        let mut buf = [0u8; 1];
        self.port.read_exact(&mut buf)
            .map_err(|e| format!("Read failed: {}", e))?;
        Ok(buf[0])
    }

    fn read_byte_timeout(&mut self, timeout_ms: u64) -> Result<u8, String> {
        self.port.set_timeout(Duration::from_millis(timeout_ms))
            .map_err(|e| format!("Timeout set failed: {}", e))?;
        let result = self.read_byte();
        self.port.set_timeout(Duration::from_millis(2000))
            .map_err(|e| format!("Timeout restore failed: {}", e))?;
        result
    }

    /// Initialize ECU communication
    fn init_ecu(&mut self) -> Result<(), String> {
        self.stop_stream();

        for _ in 0..2 {
            self.write_byte(0xFF)?;
            self.write_byte(0xFF)?;
            self.write_byte(0xEF)?;

            match self.read_byte_timeout(2000) {
                Ok(0x10) => {
                    self.stop_stream();
                    return Ok(());
                }
                Ok(_) => {
                    // Already initialized
                    self.stop_stream();
                    return Ok(());
                }
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(250));
                    continue;
                }
            }
        }
        Err("ECU init failed after 2 attempts".to_string())
    }

    /// Tell ECU to stop streaming
    fn stop_stream(&mut self) {
        let _ = self.write_byte(CMD_STOP_STREAM);
        std::thread::sleep(Duration::from_millis(100));
        let _ = self.port.clear(serialport::ClearBuffer::Input);
    }

    /// Validate command acknowledgment (ECU sends back bitwise NOT)
    fn check_ack(&mut self, cmd: u8) -> Result<(), String> {
        let ack = self.read_byte()?;
        if ack != !cmd {
            self.stop_stream();
            return Err(format!("Bad ACK: expected {:02X}, got {:02X}", !cmd, ack));
        }
        Ok(())
    }

    /// Read a single register (or register pair)
    pub fn read_register(&mut self, msb_addr: u8, lsb_addr: u8) -> Result<u16, String> {
        self.write_byte(CMD_READ_REGISTER)?;
        self.write_byte(msb_addr)?;

        if lsb_addr != REGISTER_NULL {
            self.write_byte(CMD_READ_REGISTER)?;
            self.write_byte(lsb_addr)?;
        }

        self.write_byte(CMD_TERM)?;
        self.check_ack(CMD_READ_REGISTER)?;

        // Read until start frame (0xFF)
        let mut reads = 0;
        loop {
            let b = self.read_byte()?;
            reads += 1;
            if reads > 4 {
                self.stop_stream();
                return Err("Start frame not found".to_string());
            }
            if b == 0xFF { break; }
        }

        // Byte count
        let _count = self.read_byte()?;

        // MSB
        let msb = self.read_byte()? as u16;
        let mut value = msb;

        if lsb_addr != REGISTER_NULL {
            let lsb = self.read_byte()? as u16;
            value = (value << 8) | lsb;
        }

        self.stop_stream();
        Ok(value)
    }

    /// Read all live sensors in one call
    pub fn read_sensors(&mut self) -> Result<ConsultSensors, String> {
        let rpm_raw = self.read_register(REG_TACH_MSB, REG_TACH_LSB)?;
        let coolant_raw = self.read_register(REG_COOLANT_TEMP, REGISTER_NULL)?;
        let speed_raw = self.read_register(REG_VEHICLE_SPEED, REGISTER_NULL)?;
        let volt_raw = self.read_register(REG_BATTERY_VOLTAGE, REGISTER_NULL)?;
        let timing_raw = self.read_register(REG_IGNITION_TIMING, REGISTER_NULL)?;
        let tps_raw = self.read_register(REG_TPS, REGISTER_NULL)?;
        let maf_raw = self.read_register(REG_MAF_L_MSB, REG_MAF_L_LSB)?;
        let o2l_raw = self.read_register(REG_LEFT_O2, REGISTER_NULL)?;
        let o2r_raw = self.read_register(REG_RIGHT_O2, REGISTER_NULL)?;

        Ok(ConsultSensors {
            // RPM: raw / 12.5 (per CONSULT spec)
            rpm: (rpm_raw as f32 / 12.5) as u16,
            // Coolant: raw - 50 = °C
            coolant_temp_c: (coolant_raw as i16) - 50,
            // Speed: raw * 2 = km/h
            vehicle_speed_kph: (speed_raw as u16 * 2) as u8,
            // Battery: raw * 0.08 = volts
            battery_voltage: (volt_raw as f32) * 0.08,
            // Timing: (raw - 110) / 2 = degrees BTDC
            ignition_timing: ((timing_raw as i16 - 110) / 2) as i8,
            // TPS: raw / 2.56 = percent
            tps_percent: (tps_raw as f32 / 2.56) as u8,
            // MAF: raw * 0.005 = volts
            maf_voltage: (maf_raw as f32) * 0.005,
            // O2: raw * 0.01 = volts
            left_o2_voltage: (o2l_raw as f32) * 0.01,
            right_o2_voltage: (o2r_raw as f32) * 0.01,
        })
    }

    /// Get ECU part number
    pub fn get_ecu_part_number(&mut self) -> Result<String, String> {
        self.stop_stream();
        self.write_byte(CMD_ECU_INFO)?;
        self.write_byte(CMD_TERM)?;
        self.check_ack(CMD_ECU_INFO)?;

        // Start frame
        let _ = self.read_byte()?;

        // 22 bytes of data, last 4 are part number
        let mut part = String::from("23710-");
        for i in 1..=22 {
            let b = self.read_byte()?;
            if (19..=22).contains(&i) {
                part.push(b as char);
            }
        }

        self.stop_stream();
        Ok(part)
    }

    /// Get number of stored error codes
    pub fn get_error_count(&mut self) -> Result<u8, String> {
        self.stop_stream();
        self.write_byte(CMD_SELF_DIAG)?;
        self.write_byte(CMD_TERM)?;
        self.check_ack(CMD_SELF_DIAG)?;

        let _ = self.read_byte()?; // start frame
        let count = self.read_byte()?; // byte count

        self.stop_stream();
        Ok(count / 2)
    }

    /// Clear error codes
    pub fn clear_codes(&mut self) -> Result<(), String> {
        self.stop_stream();
        self.write_byte(CMD_CLEAR_CODES)?;
        self.write_byte(CMD_TERM)?;
        self.check_ack(CMD_CLEAR_CODES)?;
        self.stop_stream();
        Ok(())
    }
}

// Note: serialport crate needed in Cargo.toml:
// [dependencies]
// serialport = "4"
