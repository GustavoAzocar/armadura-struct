//! Packages are inert data. There is deliberately no third-party runtime.
pub mod contract;
pub mod online;
pub mod package;
pub mod store;
pub use store::Service;
