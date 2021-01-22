const Deposits = artifacts.require('./Deposits.sol');
const ERC20 = artifacts.require('./ERC20Mock.sol');
const { waitUntilBlock } = require('./helpers/tempo')(web3);

contract('Deposits', ([owner, alice, bob, carl]) => {
    before(async () => {
        this.deposits = await Deposits.new();
    });

    before(async () => {
        this.token1 = await ERC20.new("Token 1", "T1", 0, 0);

        await Promise.all([
            this.token1.mint(alice, 5000),
            this.token1.mint(bob, 500),
            this.token1.mint(carl, 2000),
        ]);

        const [balanceAlice, balanceBob, balanceCarl] = await Promise.all([
            this.token1.balanceOf(alice),
            this.token1.balanceOf(bob),
            this.token1.balanceOf(carl),
        ]);

        assert.equal(5000, balanceAlice);
        assert.equal(500, balanceBob);
        assert.equal(2000, balanceCarl);
    });

    before(async () => {
        this.token2 = await ERC20.new("Token 2", "T2", 0, 0);

        await Promise.all([
            this.token2.mint(alice, 1500),
            this.token2.mint(bob, 800),
        ]);

        const [balanceAlice, balanceBob, balanceCarl] = await Promise.all([
            this.token2.balanceOf(alice),
            this.token2.balanceOf(bob),
            this.token2.balanceOf(carl),
        ]);

        assert.equal(1500, balanceAlice);
        assert.equal(800, balanceBob);
        assert.equal(0, balanceCarl);
    });

    describe('receives deposits', () => {
        before(async () => {
            await Promise.all([
                this.token1.approve(this.deposits.address, 3000, { from: alice }),
                this.token2.approve(this.deposits.address, 1000, { from: alice }),
                this.token1.approve(this.deposits.address, 500, { from: bob }),
                this.token2.approve(this.deposits.address, 100, { from: bob }),
                this.token1.approve(this.deposits.address, 1000, { from: carl })
            ]);

            await Promise.all([
                this.deposits.deposit(this.token1.address, 1500, {from: alice}),
                this.deposits.deposit(this.token2.address, 1000, {from: alice}),
                this.deposits.deposit(this.token1.address, 500, {from: bob}),
                this.deposits.deposit(this.token2.address, 100, {from: bob}),
                this.deposits.deposit(this.token1.address, 1000, {from: carl})
            ]);
        });

        it('shows the deposits of alice', async () => {
            const balanceToken1 = await this.token1.balanceOf(alice);
            const depositToken1 = await this.deposits.deposited(this.token1.address, alice);
            assert.equal(3500, balanceToken1);
            assert.equal(1500, depositToken1);

            const balanceToken2 = await this.token2.balanceOf(alice);
            const depositToken2 = await this.deposits.deposited(this.token2.address, alice);
            assert.equal(500, balanceToken2);
            assert.equal(1000, depositToken2);
        });

        it('shows the deposits of bob', async () => {
            const balanceToken1 = await this.token1.balanceOf(bob);
            const depositToken1 = await this.deposits.deposited(this.token1.address, bob);
            assert.equal(0, balanceToken1);
            assert.equal(500, depositToken1);

            const balanceToken2 = await this.token2.balanceOf(bob);
            const depositToken2 = await this.deposits.deposited(this.token2.address, bob);
            assert.equal(700, balanceToken2);
            assert.equal(100, depositToken2);
        });


        it('shows the deposits of carl', async () => {
            const balanceToken1 = await this.token1.balanceOf(carl);
            const depositToken1 = await this.deposits.deposited(this.token1.address, carl);
            assert.equal(1000, balanceToken1);
            assert.equal(1000, depositToken1);

            const balanceToken2 = await this.token2.balanceOf(carl);
            const depositToken2 = await this.deposits.deposited(this.token2.address, carl);
            assert.equal(0, balanceToken2);
            assert.equal(0, depositToken2);
        });

        it('shows the total deposit', async () => {
            const totalToken1 = await this.deposits.total(this.token1.address);
            assert.equal(3000, totalToken1);

            const totalToken2 = await this.deposits.total(this.token2.address);
            assert.equal(1100, totalToken2);
        });
    });

    describe('has a capped token', () => {
        before(async () => {
            await this.deposits.cap(this.token1.address, 20, this.token2.address, 10);
        });

        it('shows alice can\'t deposit token 2', async () => {
            const max = await this.deposits.maxDeposit(this.token2.address, alice);
            assert.equal(0, max);
        });

        it('shows bob can deposit some token 2', async () => {
            const max = await this.deposits.maxDeposit(this.token2.address, bob);
            assert.equal(150, max);
        });

        it('shows carl can deposit max token 2', async () => {
            const max = await this.deposits.maxDeposit(this.token2.address, carl);
            assert.equal(500, max);
        });

        it('won\'t allow alice to deposit more token 2', async () => {
            await this.token2.approve(this.deposits.address, 100, { from: alice });

            try {
                await this.deposits.deposit(this.token2.address, 100, {from: alice});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                assert.equal(ex.reason, 'Not allowed to deposit specified amount of capped token');
                return;
            }
            assert.fail('deposit successful');
        });

        it('won\'t allow bob to deposit more than max token 2', async () => {
            await this.token2.approve(this.deposits.address, 250, { from: bob });

            try {
                await this.deposits.deposit(this.token2.address, 250, {from: bob});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                assert.equal(ex.reason, 'Not allowed to deposit specified amount of capped token');
                return;
            }
            assert.fail('deposit successful');
        });

        it('won\'t allow bob to deposit less than max token 2', async () => {
            await this.token2.approve(this.deposits.address, 100, { from: bob });
            await this.deposits.deposit(this.token2.address, 100, {from: bob});

            const balanceToken2 = await this.token2.balanceOf(bob);
            const depositToken2 = await this.deposits.deposited(this.token2.address, bob);
            assert.equal(600, balanceToken2);
            assert.equal(200, depositToken2);
        });
    });
})
